import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { PaymentClientMode } from '@/domain/enums/PaymentClientMode';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { ApiError } from '@/server/errors/ApiError';
import { createTossPaymentProvider, TOSS_API_BASE_URL } from '@/server/payment/TossPaymentProvider';

const SECRET_KEY = 'test_sk_secret_value_123';
const CLIENT_KEY = 'test_gck_client_value_456';
const ORDER_ID = '4d6f1b44-0ad0-4d2c-a5d2-7a8a3bff0c11';

const buildProvider = (overrides: { secretKey?: string | null; clientKey?: string | null } = {}) =>
  createTossPaymentProvider({
    secretKey: overrides.secretKey === undefined ? SECRET_KEY : overrides.secretKey,
    clientKey: overrides.clientKey === undefined ? CLIENT_KEY : overrides.clientKey,
    timeoutMs: 1000,
  });

const jsonReply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const tossPayment = (status: string, overrides: Record<string, unknown> = {}) => ({
  paymentKey: 'pk_1',
  orderId: ORDER_ID,
  totalAmount: 1900,
  currency: 'KRW',
  status,
  method: '카드',
  ...overrides,
});

const stubFetch = (...replies: (Response | Error)[]) => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const reply = replies.shift();

    if (!reply) {
      throw new Error('unexpected fetch');
    }

    if (reply instanceof Error) {
      throw reply;
    }

    return reply;
  });

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TossPaymentProvider client config', () => {
  it('reports test mode for test_ keys and live mode otherwise', () => {
    expect(buildProvider().kind).toBe(PaymentProviderType.TOSS);
    expect(buildProvider().getClientConfig()).toEqual({
      clientKey: CLIENT_KEY,
      mode: PaymentClientMode.TEST,
    });
    expect(buildProvider({ clientKey: 'live_gck_abc', secretKey: 'live_sk_abc' }).getClientConfig()).toEqual({
      clientKey: 'live_gck_abc',
      mode: PaymentClientMode.LIVE,
    });
  });

  it('throws PROVIDER_NOT_CONFIGURED without keys', async () => {
    const fetchMock = stubFetch();
    const noKeys = buildProvider({ secretKey: null, clientKey: null });

    expect(() => noKeys.getClientConfig()).toThrow(ApiError);

    try {
      noKeys.getClientConfig();
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe(ApiErrorCode.PROVIDER_NOT_CONFIGURED);
    }

    await expect(noKeys.confirm({ orderId: ORDER_ID, paymentKey: 'pk', amount: 1900 })).rejects.toMatchObject(
      {
        code: ApiErrorCode.PROVIDER_NOT_CONFIGURED,
      },
    );
    await expect(noKeys.fetchPayment('pk')).rejects.toMatchObject({
      code: ApiErrorCode.PROVIDER_NOT_CONFIGURED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TossPaymentProvider confirm', () => {
  it('posts the confirm request with Basic auth and maps DONE to paid', async () => {
    const fetchMock = stubFetch(jsonReply(200, tossPayment('DONE')));
    const result = await buildProvider().confirm({ orderId: ORDER_ID, paymentKey: 'pk_1', amount: 1900 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(String(url)).toBe(`${TOSS_API_BASE_URL}/v1/payments/confirm`);
    expect(init?.method).toBe('POST');
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(`${SECRET_KEY}:`).toString('base64')}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(String(init?.body))).toEqual({ paymentKey: 'pk_1', orderId: ORDER_ID, amount: 1900 });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      ok: true,
      orderId: ORDER_ID,
      paymentKey: 'pk_1',
      amount: 1900,
      currency: 'KRW',
      status: PaymentStatus.PAID,
    });
  });

  it('maps declined payments to permanent failures and server errors to transient ones', async () => {
    stubFetch(
      jsonReply(400, {
        code: 'REJECT_CARD_PAYMENT',
        message: '한도초과 혹은 잔액부족으로 결제에 실패했습니다.',
      }),
      jsonReply(500, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: '내부 오류' }),
      jsonReply(401, { code: 'UNAUTHORIZED_KEY', message: '인증되지 않은 시크릿 키' }),
    );

    const provider = buildProvider();
    const input = { orderId: ORDER_ID, paymentKey: 'pk_1', amount: 1900 };

    expect(await provider.confirm(input)).toEqual({
      ok: false,
      code: 'REJECT_CARD_PAYMENT',
      message: '한도초과 혹은 잔액부족으로 결제에 실패했습니다.',
      transient: false,
    });
    expect(await provider.confirm(input)).toMatchObject({
      ok: false,
      code: 'FAILED_INTERNAL_SYSTEM_PROCESSING',
      transient: true,
    });
    expect(await provider.confirm(input)).toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED_KEY',
      transient: false,
    });
  });

  it('treats timeouts, network errors and malformed replies as transient', async () => {
    stubFetch(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      new TypeError('fetch failed'),
      new Response('<html>bad gateway</html>', { status: 200 }),
    );

    const provider = buildProvider();
    const input = { orderId: ORDER_ID, paymentKey: 'pk_1', amount: 1900 };

    expect(await provider.confirm(input)).toMatchObject({ ok: false, code: 'TIMEOUT', transient: true });
    expect(await provider.confirm(input)).toMatchObject({
      ok: false,
      code: 'NETWORK_ERROR',
      transient: true,
    });
    expect(await provider.confirm(input)).toMatchObject({
      ok: false,
      code: 'INVALID_RESPONSE',
      transient: true,
    });
  });

  it('looks the payment up when Toss says it was already processed', async () => {
    const fetchMock = stubFetch(
      jsonReply(400, { code: 'ALREADY_PROCESSED_PAYMENT', message: '이미 처리된 결제 입니다.' }),
      jsonReply(200, tossPayment('DONE')),
    );
    const result = await buildProvider().confirm({ orderId: ORDER_ID, paymentKey: 'pk_1', amount: 1900 });

    expect(result).toMatchObject({ ok: true, status: PaymentStatus.PAID });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`${TOSS_API_BASE_URL}/v1/payments/pk_1`);
  });

  it('never logs the secret key', async () => {
    const logs: unknown[] = [];

    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }

    stubFetch(new TypeError('fetch failed'), jsonReply(500, { code: 'X', message: 'y' }));

    const provider = buildProvider();

    await provider.confirm({ orderId: ORDER_ID, paymentKey: 'pk_1', amount: 1900 });
    await provider.fetchPayment('pk_1');

    const serialized = JSON.stringify(logs);

    expect(serialized).not.toContain(SECRET_KEY);
    expect(serialized).not.toContain(Buffer.from(`${SECRET_KEY}:`).toString('base64'));
  });
});

describe('TossPaymentProvider fetchPayment', () => {
  it('GETs the payment by key with Basic auth', async () => {
    const fetchMock = stubFetch(jsonReply(200, tossPayment('DONE', { paymentKey: 'a/b' })));

    await buildProvider().fetchPayment('a/b');

    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(String(url)).toBe(`${TOSS_API_BASE_URL}/v1/payments/a%2Fb`);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toMatch(/^Basic /);
  });

  it.each([
    ['DONE', PaymentStatus.PAID],
    ['CANCELED', PaymentStatus.CANCELED],
    ['PARTIAL_CANCELED', PaymentStatus.CANCELED],
    ['ABORTED', PaymentStatus.FAILED],
    ['EXPIRED', PaymentStatus.FAILED],
    ['READY', PaymentStatus.PENDING],
    ['IN_PROGRESS', PaymentStatus.PENDING],
    ['WAITING_FOR_DEPOSIT', PaymentStatus.PENDING],
    ['SOMETHING_NEW', PaymentStatus.PENDING],
  ])('maps %s to %s', async (tossStatus, expected) => {
    stubFetch(jsonReply(200, tossPayment(tossStatus)));

    expect(await buildProvider().fetchPayment('pk_1')).toMatchObject({ ok: true, status: expected });
  });

  it('reports lookup failures', async () => {
    stubFetch(jsonReply(404, { code: 'NOT_FOUND_PAYMENT', message: '존재하지 않는 결제 정보 입니다.' }));

    expect(await buildProvider().fetchPayment('missing')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND_PAYMENT',
      transient: false,
    });
  });
});

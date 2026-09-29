import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GET as calendarRoute } from '@/app/api/calendar/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { PaymentClientMode } from '@/domain/enums/PaymentClientMode';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type ConfirmPaymentResponse } from '@/domain/types/api/ConfirmPaymentResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { entitlements, paymentEvents, payments } from '@/server/db/Schema';
import { DUPLICATE_ENTITLEMENT_CODE } from '@/server/services/PaymentGrant';
import { setPaymentProviderForTesting } from '@/server/payment/PaymentFactory';
import { type ProviderPaymentResult } from '@/server/payment/PaymentProvider';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createLoggedInJob, createReadyDraft, patchDraft, readDraft } from '../helpers/OffnalFlows';
import {
  buildFakeProvider,
  buildMockFailKey,
  buildMockSuccessKey,
  confirmPayment,
  createPayment,
  findUserId,
  publishReady,
  requestPayment,
  sendWebhook,
  setupTrialsUsed,
} from '../helpers/PaymentFlows';

let env: IntegrationEnvironment;
const envSandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  setPaymentProviderForTesting(null);
  envSandbox.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await env.close();
});

const listEntitlements = (userId: string, yearMonth: string) =>
  env.db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.yearMonth, yearMonth)));

const findPayment = async (orderId: string) => {
  const [payment] = await env.db.select().from(payments).where(eq(payments.id, orderId));

  return payment;
};

describe('create payment', () => {
  it('requires login', async () => {
    const response = await requestPayment(createApiTestClient(), { yearMonth: '2026-12' });

    expect(response.status).toBe(401);
  });

  it('creates a server-priced order with provider redirect URLs that keep the draft ID', async () => {
    const client = createApiTestClient();
    const { paidDraft } = await setupTrialsUsed(env.db, client, '주문 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12', draftId: paidDraft.draft.id });

    expect(order).toMatchObject({
      amount: 1900,
      currency: 'KRW',
      orderName: '오프날 2026년 12월 이용권',
      yearMonth: '2026-12',
      draftId: paidDraft.draft.id,
      provider: PaymentProviderType.MOCK,
    });
    expect(order.clientConfig.mode).toBe(PaymentClientMode.MOCK);
    expect(order.clientConfig.clientKey).toBeNull();
    expect(order.clientConfig.customerKey).toMatch(/^[a-f0-9]{16,50}$/);
    expect(order.clientConfig.customerKey).not.toContain(await findUserId(env.db, '주문 사용자'));

    const successUrl = new URL(order.clientConfig.successUrl);
    const failUrl = new URL(order.clientConfig.failUrl);

    expect(successUrl.origin).toBe(TEST_APP_URL);
    expect(successUrl.pathname).toBe('/checkout/2026-12/result');
    expect(successUrl.searchParams.get('draftId')).toBe(paidDraft.draft.id);
    expect(failUrl.pathname).toBe('/checkout/2026-12/result');
    expect(failUrl.searchParams.get('status')).toBe('fail');
    expect(failUrl.searchParams.get('draftId')).toBe(paidDraft.draft.id);

    const stored = await findPayment(order.orderId);

    expect(stored).toMatchObject({ status: PaymentStatus.PENDING, amount: 1900, currency: 'KRW' });
  });

  it('reuses the pending order of the same month and updates its draft', async () => {
    const client = createApiTestClient();
    const { paidDraft } = await setupTrialsUsed(env.db, client, '재사용 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const first = await createPayment(client, { yearMonth: '2026-12' });
    const again = await createPayment(client, { yearMonth: '2026-12' });

    expect(again.orderId).toBe(first.orderId);
    expect(again.draftId).toBeNull();

    const withDraft = await createPayment(client, { yearMonth: '2026-12', draftId: paidDraft.draft.id });

    expect(withDraft.orderId).toBe(first.orderId);
    expect(withDraft.draftId).toBe(paidDraft.draft.id);
    expect((await findPayment(first.orderId))?.draftId).toBe(paidDraft.draft.id);

    const otherMonth = await createPayment(client, { yearMonth: '2027-01' });

    expect(otherMonth.orderId).not.toBe(first.orderId);
  });

  it('refuses months that already have an entitlement and foreign or mismatched drafts', async () => {
    const client = createApiTestClient();
    const { paidDraft } = await setupTrialsUsed(env.db, client, '보유 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const entitled = await requestPayment(client, { yearMonth: '2026-10' });

    expect(entitled.status).toBe(409);
    expect((await readJson<ApiErrorBody>(entitled)).error.code).toBe(ApiErrorCode.ALREADY_ENTITLED);

    const mismatched = await requestPayment(client, { yearMonth: '2027-02', draftId: paidDraft.draft.id });

    expect(mismatched.status).toBe(400);

    const stranger = createApiTestClient();

    await createLoggedInJob(stranger, '남의 초안 사용자');

    const foreign = await requestPayment(stranger, { yearMonth: '2026-12', draftId: paidDraft.draft.id });

    expect(foreign.status).toBe(404);
    expect((await requestPayment(client, { yearMonth: '2026-13' })).status).toBe(400);
  });
});

describe('confirm payment', () => {
  it('third distinct month: 402 → pay → publish succeeds with a purchase entitlement', async () => {
    const client = createApiTestClient();
    const { paidDraft, userId } = await setupTrialsUsed(env.db, client, '구매 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const blocked = await publishReady(client, paidDraft);

    expect(blocked.status).toBe(402);
    expect((await readJson<ApiErrorBody>(blocked)).error.details).toEqual({
      yearMonth: '2026-12',
      priceKrw: 1900,
    });

    const order = await createPayment(client, { yearMonth: '2026-12', draftId: paidDraft.draft.id });
    const confirmResponse = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: buildMockSuccessKey(),
      amount: order.amount,
    });
    const confirmed = await readJson<ConfirmPaymentResponse>(confirmResponse);

    expect(confirmResponse.status).toBe(200);
    expect(confirmed).toEqual({
      orderId: order.orderId,
      yearMonth: '2026-12',
      status: PaymentStatus.PAID,
      draftId: paidDraft.draft.id,
    });

    const [entitlement] = await listEntitlements(userId, '2026-12');

    expect(entitlement).toMatchObject({ source: EntitlementSource.PURCHASE, paymentId: order.orderId });

    const published = await publishReady(client, paidDraft);

    expect(published.status).toBe(200);
    expect(await readJson<PublishDraftResponse>(published)).toMatchObject({
      usedTrial: false,
      yearMonth: '2026-12',
    });

    const stored = await findPayment(order.orderId);

    expect(stored?.status).toBe(PaymentStatus.PAID);
    expect(stored?.confirmedAt).not.toBeNull();
    expect(stored?.providerPaymentKey).toMatch(/^mock_success_/);
    expect((await requestPayment(client, { yearMonth: '2026-12' })).status).toBe(409);
  });

  it('rejects a tampered amount without calling the provider or granting anything', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '변조 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    const response = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: buildMockSuccessKey(),
      amount: 100,
    });

    expect(response.status).toBe(400);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe(ApiErrorCode.AMOUNT_MISMATCH);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);
    expect((await findPayment(order.orderId))?.status).toBe(PaymentStatus.PENDING);
  });

  it('a failed payment leaves no entitlement, keeps the draft editing and the calendar unchanged', async () => {
    const client = createApiTestClient();
    const { paidDraft, userId } = await setupTrialsUsed(env.db, client, '실패 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const before = await readJson<CalendarSummaryResponse>(await client.send(calendarRoute, '/api/calendar'));
    const order = await createPayment(client, { yearMonth: '2026-12', draftId: paidDraft.draft.id });
    const response = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: buildMockFailKey(),
      amount: order.amount,
    });
    const body = await readJson<ApiErrorBody>(response);

    expect(response.status).toBe(402);
    expect(body.error.code).toBe(ApiErrorCode.PAYMENT_FAILED);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);

    const stored = await findPayment(order.orderId);

    expect(stored?.status).toBe(PaymentStatus.FAILED);
    expect(stored?.failureCode).toBeTruthy();

    const draft = await readDraft(client, paidDraft.draft.id);

    expect(draft.draft.status).toBe(DraftStatus.EDITING);
    expect(draft.draft.revision).toBe(paidDraft.draft.revision);

    const after = await readJson<CalendarSummaryResponse>(await client.send(calendarRoute, '/api/calendar'));

    expect(after.months).toEqual(before.months);
    expect((await publishReady(client, paidDraft)).status).toBe(402);

    const retryOrder = await createPayment(client, { yearMonth: '2026-12' });

    expect(retryOrder.orderId).not.toBe(order.orderId);
  });

  it('duplicate confirms grant one entitlement and return the same response', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '중복 확인 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    const body = { orderId: order.orderId, paymentKey: buildMockSuccessKey(), amount: order.amount };
    const responses = await Promise.all([confirmPayment(client, body), confirmPayment(client, body)]);
    const again = await confirmPayment(client, body);
    const bodies = await Promise.all(
      [...responses, again].map((response) => readJson<ConfirmPaymentResponse>(response)),
    );

    expect([...responses, again].map((response) => response.status)).toEqual([200, 200, 200]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
  });

  it('hides other users orders and requires the same origin', async () => {
    const owner = createApiTestClient();

    await setupTrialsUsed(env.db, owner, '주문 소유자', ['2026-10', '2026-11', '2026-12']);

    const order = await createPayment(owner, { yearMonth: '2026-12' });
    const stranger = createApiTestClient();

    await createLoggedInJob(stranger, '주문 침입자');

    const body = { orderId: order.orderId, paymentKey: buildMockSuccessKey(), amount: order.amount };

    expect((await confirmPayment(stranger, body)).status).toBe(404);
    expect((await confirmPayment(stranger, { ...body, orderId: 'not-a-uuid' })).status).toBe(404);

    const crossSite = await owner.send(
      (await import('@/app/api/payments/confirm/route')).POST,
      '/api/payments/confirm',
      {
        json: body,
        origin: 'https://evil.example',
      },
    );

    expect(crossSite.status).toBe(403);
    expect((await findPayment(order.orderId))?.status).toBe(PaymentStatus.PENDING);
  });

  it('payment succeeded but publish failed: publishing later needs no second payment', async () => {
    const client = createApiTestClient();
    const { paidDraft, userId } = await setupTrialsUsed(env.db, client, '재발행 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12', draftId: paidDraft.draft.id });

    expect(
      (
        await confirmPayment(client, {
          orderId: order.orderId,
          paymentKey: buildMockSuccessKey(),
          amount: order.amount,
        })
      ).status,
    ).toBe(200);

    // The publish after payment fails: a date was cleared in the meantime (blocker).
    const blockedEntries = paidDraft.draft.entries.map((entry, index) =>
      index === 0 ? { ...entry, code: null, confirmed: false } : entry,
    );
    const blockedDraft = await readJson<DraftResponse>(
      await patchDraft(client, paidDraft.draft.id, {
        revision: paidDraft.draft.revision,
        entries: blockedEntries,
      }),
    );

    expect((await publishReady(client, blockedDraft)).status).toBe(422);

    const fixed = await readJson<DraftResponse>(
      await patchDraft(client, paidDraft.draft.id, {
        revision: blockedDraft.draft.revision,
        entries: paidDraft.draft.entries,
      }),
    );
    const published = await publishReady(client, fixed);

    expect(published.status).toBe(200);
    expect(await readJson<PublishDraftResponse>(published)).toMatchObject({ usedTrial: false });
    expect(await env.db.select().from(payments).where(eq(payments.userId, userId))).toHaveLength(1);
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
  });
});

describe('payment webhook', () => {
  const buildEvent = (orderId: string, paymentKey: string, status = 'DONE') => ({
    eventType: 'PAYMENT_STATUS_CHANGED',
    createdAt: '2026-12-01T10:00:00.000000',
    data: { paymentKey, orderId, status },
  });

  it('duplicate events after a confirm are harmless', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '웹훅 중복 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    const paymentKey = buildMockSuccessKey();

    await confirmPayment(client, { orderId: order.orderId, paymentKey, amount: order.amount });

    const webhookClient = createApiTestClient();
    const first = await sendWebhook(webhookClient, buildEvent(order.orderId, paymentKey));
    const second = await sendWebhook(webhookClient, buildEvent(order.orderId, paymentKey));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);

    const events = await env.db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.provider, PaymentProviderType.MOCK));

    expect(events.filter((event) => event.eventKey.includes(paymentKey))).toHaveLength(1);
  });

  it('grants from the provider lookup only, never from the payload status', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '웹훅 조회 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    let providerStatus = PaymentStatus.PENDING;
    let providerAmount = order.amount;
    const fetched: string[] = [];
    const fakeProvider = buildFakeProvider({
      fetchPayment: async (paymentKey: string): Promise<ProviderPaymentResult> => {
        fetched.push(paymentKey);

        return {
          ok: true,
          orderId: order.orderId,
          paymentKey,
          amount: providerAmount,
          currency: 'KRW',
          status: providerStatus,
        };
      },
    });

    setPaymentProviderForTesting(fakeProvider);

    const webhookClient = createApiTestClient();

    // Payload claims DONE, provider says still pending → nothing granted.
    expect((await sendWebhook(webhookClient, buildEvent(order.orderId, 'toss_key_1'))).status).toBe(200);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);

    // Provider says paid, but for a different amount → nothing granted.
    providerStatus = PaymentStatus.PAID;
    providerAmount = 10;
    expect((await sendWebhook(webhookClient, buildEvent(order.orderId, 'toss_key_2'))).status).toBe(200);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);

    providerAmount = order.amount;
    expect((await sendWebhook(webhookClient, buildEvent(order.orderId, 'toss_key_3'))).status).toBe(200);
    expect(fetched).toEqual(['toss_key_1', 'toss_key_2', 'toss_key_3']);

    const [entitlement] = await listEntitlements(userId, '2026-12');

    expect(entitlement).toMatchObject({ source: EntitlementSource.PURCHASE, paymentId: order.orderId });
    expect((await findPayment(order.orderId))?.status).toBe(PaymentStatus.PAID);

    // Confirm after the webhook grant is an idempotent success.
    const confirmResponse = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: 'toss_key_3',
      amount: order.amount,
    });

    expect(confirmResponse.status).toBe(200);
    expect((await readJson<ConfirmPaymentResponse>(confirmResponse)).status).toBe(PaymentStatus.PAID);
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
  });

  it('answers 200 to unknown, malformed or foreign events and 5xx on transient lookups', async () => {
    const webhookClient = createApiTestClient();

    expect((await sendWebhook(webhookClient, { hello: 'world' })).status).toBe(200);
    expect((await sendWebhook(webhookClient, buildEvent('not-a-uuid', 'k1'))).status).toBe(200);
    expect(
      (
        await sendWebhook(
          webhookClient,
          buildEvent('00000000-0000-4000-8000-000000000000', buildMockSuccessKey()),
        )
      ).status,
    ).toBe(200);

    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '웹훅 재시도 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    let transient = true;

    setPaymentProviderForTesting(
      buildFakeProvider({
        fetchPayment: async (paymentKey) =>
          transient
            ? { ok: false, code: 'NETWORK_ERROR', message: 'timeout', transient: true }
            : {
                ok: true,
                orderId: order.orderId,
                paymentKey,
                amount: order.amount,
                currency: 'KRW',
                status: PaymentStatus.PAID,
              },
      }),
    );

    const event = buildEvent(order.orderId, 'toss_retry_key');
    const failed = await sendWebhook(webhookClient, event);

    expect(failed.status).toBe(502);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);

    transient = false;

    // The provider retries the same event: it is processed, not skipped as a duplicate.
    expect((await sendWebhook(webhookClient, event)).status).toBe(200);
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
  });
});

describe('nothing to buy', () => {
  it('refuses an order while a free month is still available', async () => {
    const fresh = createApiTestClient();

    await createLoggedInJob(fresh, '무료 남은 사용자');

    const response = await requestPayment(fresh, { yearMonth: '2026-12' });
    const body = await readJson<ApiErrorBody>(response);

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ApiErrorCode.FREE_MONTH_AVAILABLE);
    expect(body.error.message).toBe('무료로 저장할 수 있는 달이 남아 있어요.');

    const oneLeft = createApiTestClient();
    const jobId = await createLoggedInJob(oneLeft, '무료 하나 남은 사용자');

    await publishReady(oneLeft, await createReadyDraft(oneLeft, jobId, '2026-10'));

    expect(
      (await readJson<ApiErrorBody>(await requestPayment(oneLeft, { yearMonth: '2026-12' }))).error.code,
    ).toBe(ApiErrorCode.FREE_MONTH_AVAILABLE);
  });

  it('does not charge when the month became entitled after the order was created', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '이중 결제 방지 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    const confirm = vi.fn(async (): Promise<ProviderPaymentResult> => ({
      ok: true,
      orderId: order.orderId,
      paymentKey: 'pk',
      amount: order.amount,
      currency: 'KRW',
      status: PaymentStatus.PAID,
    }));

    setPaymentProviderForTesting(buildFakeProvider({ confirm }));
    await env.db
      .insert(entitlements)
      .values({ userId, yearMonth: '2026-12', source: EntitlementSource.PURCHASE });

    const response = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: 'pk',
      amount: order.amount,
    });

    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe(ApiErrorCode.ALREADY_ENTITLED);
    expect(confirm).not.toHaveBeenCalled();
    expect((await findPayment(order.orderId))?.status).toBe(PaymentStatus.CANCELED);
  });

  it('flags a paid order whose month was already entitled for a refund', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '환불 필요 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    setPaymentProviderForTesting(
      buildFakeProvider({
        fetchPayment: async (paymentKey) => ({
          ok: true,
          orderId: order.orderId,
          paymentKey,
          amount: order.amount,
          currency: 'KRW',
          status: PaymentStatus.PAID,
        }),
      }),
    );
    await env.db
      .insert(entitlements)
      .values({ userId, yearMonth: '2026-12', source: EntitlementSource.TRIAL });

    const response = await sendWebhook(createApiTestClient(), {
      eventType: 'PAYMENT_STATUS_CHANGED',
      createdAt: '2026-12-01T10:00:00.000000',
      data: { paymentKey: 'pk_dup', orderId: order.orderId, status: 'DONE' },
    });

    expect(response.status).toBe(200);
    expect(await findPayment(order.orderId)).toMatchObject({
      status: PaymentStatus.PAID,
      failureCode: DUPLICATE_ENTITLEMENT_CODE,
    });
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith('[payment] paid without new entitlement', {
      paymentId: order.orderId,
    });
  });
});

describe('confirm verification', () => {
  it.each([
    ['another currency', { currency: 'USD' }, 'VERIFICATION_MISMATCH'],
    ['another amount', { amount: 100 }, 'VERIFICATION_MISMATCH'],
    ['another order', { orderId: '00000000-0000-4000-8000-000000000001' }, 'VERIFICATION_MISMATCH'],
    ['CANCELED at the provider', { status: PaymentStatus.CANCELED }, 'NOT_PAID_canceled'],
    ['ABORTED at the provider (mapped to failed)', { status: PaymentStatus.FAILED }, 'NOT_PAID_failed'],
  ])('rejects %s with 402 and grants nothing', async (_label, override, providerCode) => {
    const client = createApiTestClient();
    const name = `검증 사용자 ${providerCode} ${Object.keys(override).join()}`;
    const { userId } = await setupTrialsUsed(env.db, client, name, ['2026-10', '2026-11', '2026-12']);
    const order = await createPayment(client, { yearMonth: '2026-12' });

    setPaymentProviderForTesting(
      buildFakeProvider({
        confirm: async (input) => ({
          ok: true,
          orderId: input.orderId,
          paymentKey: input.paymentKey,
          amount: input.amount,
          currency: 'KRW',
          status: PaymentStatus.PAID,
          ...override,
        }),
      }),
    );

    const response = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: 'pk_v',
      amount: order.amount,
    });
    const body = await readJson<ApiErrorBody>(response);

    expect(response.status).toBe(402);
    expect(body.error.code).toBe(ApiErrorCode.PAYMENT_FAILED);
    expect(body.error.details?.providerCode).toBe(providerCode);
    expect(await findPayment(order.orderId)).toMatchObject({
      status: PaymentStatus.FAILED,
      failureCode: providerCode,
    });
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);
  });

  it('keeps a waiting virtual account pending without an entitlement', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '입금 대기 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });

    setPaymentProviderForTesting(
      buildFakeProvider({
        confirm: async (input) => ({
          ok: true,
          orderId: input.orderId,
          paymentKey: input.paymentKey,
          amount: input.amount,
          currency: 'KRW',
          status: PaymentStatus.PENDING,
        }),
      }),
    );

    const response = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: 'pk_wait',
      amount: order.amount,
    });

    expect(response.status).toBe(200);
    expect((await readJson<ConfirmPaymentResponse>(response)).status).toBe(PaymentStatus.PENDING);
    expect(await findPayment(order.orderId)).toMatchObject({
      status: PaymentStatus.PENDING,
      providerPaymentKey: 'pk_wait',
    });
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);
  });
});

describe('webhook guards', () => {
  const countEvents = async (): Promise<number> => (await env.db.select().from(paymentEvents)).length;

  it('records nothing for unknown orders or orders of another provider', async () => {
    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '다른 제공자 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const [tossOrder] = await env.db
      .insert(payments)
      .values({
        userId,
        yearMonth: '2026-12',
        amount: 1900,
        provider: PaymentProviderType.TOSS,
        status: PaymentStatus.PENDING,
      })
      .returning();
    const before = await countEvents();
    const webhookClient = createApiTestClient();

    for (const orderId of ['not-a-uuid', '00000000-0000-4000-8000-000000000000', tossOrder?.id ?? '']) {
      const response = await sendWebhook(webhookClient, {
        eventType: 'PAYMENT_STATUS_CHANGED',
        createdAt: '2026-12-01T10:00:00.000000',
        data: { paymentKey: buildMockSuccessKey(), orderId, status: 'DONE' },
      });

      expect(response.status).toBe(200);
    }

    expect(await countEvents()).toBe(before);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);
  });

  it('rate-limits webhook deliveries per IP', async () => {
    envSandbox.set({ RATE_LIMIT_WEBHOOK_IP_DAILY: '2' });

    const webhookClient = createApiTestClient();

    expect((await sendWebhook(webhookClient, { hello: 1 })).status).toBe(200);
    expect((await sendWebhook(webhookClient, { hello: 2 })).status).toBe(200);
    expect((await sendWebhook(webhookClient, { hello: 3 })).status).toBe(429);
  });
});

describe('Toss virtual account webhooks (mocked fetch)', () => {
  const jsonReply = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('grants on a deposit callback and records a later cancel without revoking the month', async () => {
    envSandbox.set({
      PAYMENT_PROVIDER: 'toss',
      TOSS_CLIENT_KEY: 'test_gck_offnal',
      TOSS_SECRET_KEY: 'test_sk_offnal',
    });

    const client = createApiTestClient();
    const { userId } = await setupTrialsUsed(env.db, client, '가상계좌 사용자', [
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    const order = await createPayment(client, { yearMonth: '2026-12' });
    let tossStatus = 'WAITING_FOR_DEPOSIT';
    const tossPayment = () => ({
      paymentKey: 'toss_va_key',
      orderId: order.orderId,
      totalAmount: order.amount,
      currency: 'KRW',
      status: tossStatus,
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL): Promise<Response> => jsonReply(tossPayment()));

    vi.stubGlobal('fetch', fetchMock);

    expect(order.provider).toBe(PaymentProviderType.TOSS);
    expect(order.clientConfig).toMatchObject({ mode: PaymentClientMode.TEST, clientKey: 'test_gck_offnal' });

    const confirmResponse = await confirmPayment(client, {
      orderId: order.orderId,
      paymentKey: 'toss_va_key',
      amount: order.amount,
    });

    expect((await readJson<ConfirmPaymentResponse>(confirmResponse)).status).toBe(PaymentStatus.PENDING);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);

    // Deposit arrives: Toss posts top-level fields only; the server looks the payment up by order ID.
    tossStatus = 'DONE';

    const webhookClient = createApiTestClient();
    const deposit = {
      createdAt: '2026-12-02T09:00:00.000000',
      secret: 'va-secret',
      status: 'DONE',
      transactionKey: 'tx_1',
      orderId: order.orderId,
    };

    expect((await sendWebhook(webhookClient, deposit)).status).toBe(200);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      `https://api.tosspayments.com/v1/payments/orders/${order.orderId}`,
    );
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
    expect((await findPayment(order.orderId))?.status).toBe(PaymentStatus.PAID);
    expect(JSON.stringify(await env.db.select().from(paymentEvents))).not.toContain('va-secret');

    // Refund at Toss: order becomes canceled, the entitlement stays (refund policy undecided).
    tossStatus = 'CANCELED';

    const cancel = await sendWebhook(webhookClient, {
      eventType: 'PAYMENT_STATUS_CHANGED',
      createdAt: '2026-12-03T09:00:00.000000',
      data: { paymentKey: 'toss_va_key', orderId: order.orderId, status: 'CANCELED' },
    });

    expect(cancel.status).toBe(200);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      'https://api.tosspayments.com/v1/payments/toss_va_key',
    );
    expect((await findPayment(order.orderId))?.status).toBe(PaymentStatus.CANCELED);
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
  });
});

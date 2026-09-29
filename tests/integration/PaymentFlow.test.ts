import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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
import { setPaymentProviderForTesting } from '@/server/payment/PaymentFactory';
import { type PaymentProvider, type ProviderPaymentResult } from '@/server/payment/PaymentProvider';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createLoggedInJob, patchDraft, readDraft } from '../helpers/OffnalFlows';
import {
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

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  setPaymentProviderForTesting(null);
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
    const fakeProvider: PaymentProvider = {
      kind: PaymentProviderType.MOCK,
      getClientConfig: () => ({ clientKey: null, mode: PaymentClientMode.MOCK }),
      confirm: async (): Promise<ProviderPaymentResult> => ({
        ok: false,
        code: 'UNUSED',
        message: '',
        transient: false,
      }),
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
    };

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

    setPaymentProviderForTesting({
      kind: PaymentProviderType.MOCK,
      getClientConfig: () => ({ clientKey: null, mode: PaymentClientMode.MOCK }),
      confirm: async () => ({ ok: false, code: 'UNUSED', message: '', transient: false }),
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
    });

    const event = buildEvent(order.orderId, 'toss_retry_key');
    const failed = await sendWebhook(webhookClient, event);

    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await listEntitlements(userId, '2026-12')).toEqual([]);

    transient = false;

    // The provider retries the same event: it is processed, not skipped as a duplicate.
    expect((await sendWebhook(webhookClient, event)).status).toBe(200);
    expect(await listEntitlements(userId, '2026-12')).toHaveLength(1);
  });
});

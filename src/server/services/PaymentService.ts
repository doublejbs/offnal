import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { type PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { type ConfirmPaymentRequest } from '@/domain/types/api/ConfirmPaymentRequest';
import { type ConfirmPaymentResponse } from '@/domain/types/api/ConfirmPaymentResponse';
import { type CreatePaymentRequest } from '@/domain/types/api/CreatePaymentRequest';
import { type CreatePaymentResponse } from '@/domain/types/api/CreatePaymentResponse';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { formatYearMonthLabel } from '@/domain/YearMonth';
import { track } from '@/server/analytics/Analytics';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing, PRICE_CURRENCY } from '@/server/config/PricingConfig';
import { hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { entitlements, paymentEvents, type PaymentRow, payments, users } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { buildAppUrl } from '@/server/http/RouteHelpers';
import { getPaymentProvider } from '@/server/payment/PaymentFactory';
import { type ProviderPaymentSuccess } from '@/server/payment/PaymentProvider';
import { findOwnedDraft } from '@/server/services/DraftService';
import { hasEntitlement } from '@/server/services/EntitlementService';
import { requireUser } from '@/server/validation/RequestGuards';

const CUSTOMER_KEY_LENGTH = 40;
const MAX_EVENT_KEY_LENGTH = 500;
const VERIFICATION_MISMATCH_CODE = 'VERIFICATION_MISMATCH';
const NOT_PAID_CODE_PREFIX = 'NOT_PAID_';
/** Toss sends this header on webhook deliveries; retries of the same delivery reuse it. */
const TOSS_TRANSMISSION_ID_HEADER = 'tosspayments-webhook-transmission-id';
const UUID_SCHEMA = z.uuid();

const ORDER_CLOSED_MESSAGE = '이 주문은 더 이상 결제할 수 없어요. 결제를 다시 시작해 주세요.';
const PAYMENT_DECLINED_MESSAGE = '결제가 완료되지 않았어요. 초안은 그대로 남아 있어요.';
const PROVIDER_PENDING_MESSAGE = '결제 확인이 지연되고 있어요. 잠시 후 다시 시도해 주세요.';

/** Toss `PAYMENT_STATUS_CHANGED` (`{ eventType, createdAt, data: { paymentKey, orderId, status } }`). */
const webhookPayloadSchema = z.object({
  eventType: z.string().max(100).optional(),
  createdAt: z.string().max(100).optional(),
  data: z.object({
    paymentKey: z.string().min(1).max(200),
    orderId: z.string().min(1).max(64),
    status: z.string().max(50).optional(),
  }),
});

type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

type GrantOutcome = {
  payment: PaymentRow;
  granted: boolean;
};

export const buildOrderName = (yearMonth: string): string =>
  `오프날 ${formatYearMonthLabel(yearMonth)} 이용권`;

/** Stable, non-PII provider customer key (keyed hash of the user ID). */
export const buildCustomerKey = (userId: string): string =>
  hashSha256Hex(`${getAppConfig().appSecret}:customer:${userId}`).slice(0, CUSTOMER_KEY_LENGTH);

/** `${APP_URL}/checkout/:ym/result` keeping `draftId`; the fail URL adds `status=fail`. */
const buildResultUrl = (yearMonth: string, draftId: string | null, failed: boolean): string => {
  const url = buildAppUrl(`/checkout/${yearMonth}/result`);

  if (failed) {
    url.searchParams.set('status', 'fail');
  }

  if (draftId) {
    url.searchParams.set('draftId', draftId);
  }

  return url.toString();
};

const toConfirmResponse = (payment: PaymentRow): ConfirmPaymentResponse => ({
  orderId: payment.id,
  yearMonth: payment.yearMonth,
  status: payment.status,
  draftId: payment.draftId,
});

const findPendingPayment = async (db: DbExecutor, userId: string, yearMonth: string): Promise<PaymentRow[]> =>
  db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.userId, userId),
        eq(payments.yearMonth, yearMonth),
        eq(payments.status, PaymentStatus.PENDING),
      ),
    );

/**
 * POST /api/payments. One pending order per user and month is reused (price/provider changes cancel the
 * old one). The amount always comes from PricingConfig.
 */
export const createPayment = async (
  db: Db,
  context: RequestContext,
  body: CreatePaymentRequest,
): Promise<CreatePaymentResponse> => {
  const { user } = requireUser(context);
  const provider = getPaymentProvider();
  const clientConfig = provider.getClientConfig();
  const { yearMonth } = body;
  const draftId = body.draftId ?? null;

  if (draftId) {
    const draft = await findOwnedDraft(db, user.id, draftId);

    if (draft.yearMonth !== yearMonth) {
      throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { details: { fields: ['draftId'] } });
    }
  }

  const { priceKrw } = getPricing(getAppConfig());
  const payment = await db.transaction(async (tx) => {
    // Per-user serialization so concurrent requests cannot create two pending orders.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');

    if (await hasEntitlement(tx, user.id, yearMonth)) {
      throw new ApiError(ApiErrorCode.ALREADY_ENTITLED);
    }

    const pending = await findPendingPayment(tx, user.id, yearMonth);
    const reusable = pending.find(
      (row) => row.provider === provider.kind && row.amount === priceKrw && row.currency === PRICE_CURRENCY,
    );

    for (const row of pending) {
      if (row !== reusable) {
        await tx.update(payments).set({ status: PaymentStatus.CANCELED }).where(eq(payments.id, row.id));
      }
    }

    if (reusable) {
      const [updated] = await tx
        .update(payments)
        .set({ draftId: draftId ?? reusable.draftId, updatedAt: new Date() })
        .where(eq(payments.id, reusable.id))
        .returning();

      return updated ?? reusable;
    }

    const [inserted] = await tx
      .insert(payments)
      .values({
        userId: user.id,
        yearMonth,
        amount: priceKrw,
        currency: PRICE_CURRENCY,
        provider: provider.kind,
        status: PaymentStatus.PENDING,
        draftId,
      })
      .returning();

    if (!inserted) {
      throw new Error('Payment insert returned no row');
    }

    return inserted;
  });

  track(AnalyticsEvent.PAYMENT_SHOWN, { amount: payment.amount });

  return {
    orderId: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    orderName: buildOrderName(yearMonth),
    yearMonth,
    draftId: payment.draftId,
    provider: payment.provider,
    clientConfig: {
      mode: clientConfig.mode,
      clientKey: clientConfig.clientKey,
      customerKey: buildCustomerKey(user.id),
      successUrl: buildResultUrl(yearMonth, payment.draftId, false),
      failUrl: buildResultUrl(yearMonth, payment.draftId, true),
    },
  };
};

/**
 * Single grant path (confirm and webhook): locks the payment row, marks it paid and inserts the
 * purchase entitlement. Already paid → returned as-is (idempotent). Unique conflicts are harmless.
 */
const grantPaidPayment = async (db: Db, paymentId: string, paymentKey: string): Promise<GrantOutcome> => {
  const outcome = await db.transaction(async (tx): Promise<GrantOutcome> => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');

    if (!locked) {
      throw new ApiError(ApiErrorCode.NOT_FOUND);
    }

    if (locked.status === PaymentStatus.PAID) {
      return { payment: locked, granted: false };
    }

    const [updated] = await tx
      .update(payments)
      .set({
        status: PaymentStatus.PAID,
        providerPaymentKey: paymentKey,
        failureCode: null,
        confirmedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    await tx
      .insert(entitlements)
      .values({
        userId: locked.userId,
        yearMonth: locked.yearMonth,
        source: EntitlementSource.PURCHASE,
        paymentId: locked.id,
      })
      .onConflictDoNothing();

    return { payment: updated ?? locked, granted: true };
  });

  if (outcome.granted) {
    track(AnalyticsEvent.PAYMENT_SUCCEEDED, { amount: outcome.payment.amount });
  }

  return outcome;
};

/** Only a still-pending order is marked failed (a concurrent success must win). */
const markPaymentFailed = async (db: DbExecutor, paymentId: string, failureCode: string): Promise<void> => {
  await db
    .update(payments)
    .set({ status: PaymentStatus.FAILED, failureCode: failureCode.slice(0, 100) })
    .where(and(eq(payments.id, paymentId), eq(payments.status, PaymentStatus.PENDING)));
};

/** orderId, amount and currency of the provider's record must match the stored order exactly. */
const matchesOrder = (result: ProviderPaymentSuccess, payment: PaymentRow): boolean =>
  result.orderId === payment.id && result.amount === payment.amount && result.currency === payment.currency;

const throwDeclined = (providerCode: string): never => {
  throw new ApiError(ApiErrorCode.PAYMENT_FAILED, {
    message: PAYMENT_DECLINED_MESSAGE,
    details: { providerCode },
  });
};

const findOwnedPayment = async (db: DbExecutor, userId: string, orderId: string): Promise<PaymentRow> => {
  if (!UUID_SCHEMA.safeParse(orderId).success) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, orderId), eq(payments.userId, userId)))
    .limit(1);

  if (!payment) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return payment;
};

/**
 * POST /api/payments/confirm. Declines → payment `failed` + 402 PAYMENT_FAILED (drafts and published
 * months untouched). Transient provider errors → 502 PROVIDER_ERROR with the order still pending, so the
 * client can retry and a webhook can still grant it.
 */
export const confirmPayment = async (
  db: Db,
  context: RequestContext,
  body: ConfirmPaymentRequest,
): Promise<ConfirmPaymentResponse> => {
  const { user } = requireUser(context);
  const payment = await findOwnedPayment(db, user.id, body.orderId);

  if (payment.status === PaymentStatus.PAID) {
    return toConfirmResponse(payment);
  }

  if (body.amount !== payment.amount) {
    throw new ApiError(ApiErrorCode.AMOUNT_MISMATCH);
  }

  const provider = getPaymentProvider();

  if (payment.status !== PaymentStatus.PENDING || payment.provider !== provider.kind) {
    throw new ApiError(ApiErrorCode.PAYMENT_FAILED, { message: ORDER_CLOSED_MESSAGE });
  }

  const result = await provider.confirm({
    orderId: payment.id,
    paymentKey: body.paymentKey,
    amount: payment.amount,
  });

  if (!result.ok) {
    if (result.transient) {
      console.warn('[payment] confirm deferred', { provider: provider.kind, code: result.code });

      throw new ApiError(ApiErrorCode.PROVIDER_ERROR, { message: PROVIDER_PENDING_MESSAGE });
    }

    await markPaymentFailed(db, payment.id, result.code);

    return throwDeclined(result.code);
  }

  if (!matchesOrder(result, payment)) {
    console.error('[payment] provider result does not match the order', { provider: provider.kind });
    await markPaymentFailed(db, payment.id, VERIFICATION_MISMATCH_CODE);

    return throwDeclined(VERIFICATION_MISMATCH_CODE);
  }

  if (result.status === PaymentStatus.PENDING) {
    // e.g. virtual account waiting for deposit: the webhook grants it later.
    return toConfirmResponse(payment);
  }

  if (result.status !== PaymentStatus.PAID) {
    const code = `${NOT_PAID_CODE_PREFIX}${result.status}`;

    await markPaymentFailed(db, payment.id, code);

    return throwDeclined(code);
  }

  return toConfirmResponse((await grantPaidPayment(db, payment.id, result.paymentKey)).payment);
};

const buildEventKey = (payload: WebhookPayload, transmissionId: string | null): string =>
  (
    transmissionId ??
    [
      payload.eventType ?? '',
      payload.data.paymentKey,
      payload.data.status ?? '',
      payload.createdAt ?? '',
    ].join(':')
  ).slice(0, MAX_EVENT_KEY_LENGTH);

/** Records the event; returns false when the same event was already fully processed. */
const recordEvent = async (db: Db, provider: PaymentProviderType, eventKey: string): Promise<boolean> => {
  const [inserted] = await db
    .insert(paymentEvents)
    .values({ provider, eventKey })
    .onConflictDoNothing()
    .returning({ id: paymentEvents.id });

  if (inserted) {
    return true;
  }

  const [existing] = await db
    .select({ processedAt: paymentEvents.processedAt })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.provider, provider), eq(paymentEvents.eventKey, eventKey)));

  // Unprocessed (an earlier delivery failed transiently): process again.
  return !existing?.processedAt;
};

const markEventProcessed = async (db: Db, provider: PaymentProviderType, eventKey: string): Promise<void> => {
  await db
    .update(paymentEvents)
    .set({ processedAt: new Date() })
    .where(
      and(
        eq(paymentEvents.provider, provider),
        eq(paymentEvents.eventKey, eventKey),
        isNull(paymentEvents.processedAt),
      ),
    );
};

const applyWebhookEvent = async (db: Db, payload: WebhookPayload): Promise<void> => {
  const { orderId, paymentKey } = payload.data;

  if (!UUID_SCHEMA.safeParse(orderId).success) {
    return;
  }

  const [payment] = await db.select().from(payments).where(eq(payments.id, orderId)).limit(1);

  if (!payment) {
    return;
  }

  // Never trust the payload's status: look the payment up at the provider.
  const fetched = await getPaymentProvider().fetchPayment(paymentKey);

  if (!fetched.ok) {
    if (fetched.transient) {
      throw new ApiError(ApiErrorCode.PROVIDER_ERROR);
    }

    return;
  }

  if (!matchesOrder(fetched, payment) || fetched.status !== PaymentStatus.PAID) {
    return;
  }

  await grantPaidPayment(db, payment.id, fetched.paymentKey);
};

/**
 * POST /api/payments/webhook. Unknown, malformed and duplicate events → 200 no-op. Transient provider
 * lookups throw (5xx) and leave the event unprocessed so the provider's retry is handled.
 */
export const handlePaymentWebhook = async (db: Db, body: unknown, headers: Headers): Promise<OkResponse> => {
  const parsed = webhookPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return { ok: true };
  }

  const provider = getPaymentProvider();
  const eventKey = buildEventKey(parsed.data, headers.get(TOSS_TRANSMISSION_ID_HEADER));

  if (!(await recordEvent(db, provider.kind, eventKey))) {
    return { ok: true };
  }

  await applyWebhookEvent(db, parsed.data);
  await markEventProcessed(db, provider.kind, eventKey);

  return { ok: true };
};

import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { type ConfirmPaymentRequest } from '@/domain/types/api/ConfirmPaymentRequest';
import { type ConfirmPaymentResponse } from '@/domain/types/api/ConfirmPaymentResponse';
import { type CreatePaymentRequest } from '@/domain/types/api/CreatePaymentRequest';
import { type CreatePaymentResponse } from '@/domain/types/api/CreatePaymentResponse';
import { getFreeRemaining } from '@/domain/EntitlementPolicy';
import { formatYearMonthLabel } from '@/domain/YearMonth';
import { track } from '@/server/analytics/Analytics';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing, PRICE_CURRENCY } from '@/server/config/PricingConfig';
import { hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { type PaymentRow, payments, users } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { buildAppUrl } from '@/server/http/RouteHelpers';
import { getPaymentProvider } from '@/server/payment/PaymentFactory';
import { findOwnedDraft } from '@/server/services/DraftService';
import { countTrialEntitlements, hasEntitlement } from '@/server/services/EntitlementService';
import {
  grantPaidPayment,
  markPaymentCanceled,
  markPaymentFailed,
  matchesOrder,
} from '@/server/services/PaymentGrant';
import { assertPaymentsEnabled } from '@/server/services/PaymentGuard';
import { requireUser } from '@/server/validation/RequestGuards';

const CUSTOMER_KEY_LENGTH = 40;
const VERIFICATION_MISMATCH_CODE = 'VERIFICATION_MISMATCH';
const NOT_PAID_CODE_PREFIX = 'NOT_PAID_';
const UUID_SCHEMA = z.uuid();

const ORDER_CLOSED_MESSAGE = '이 주문은 더 이상 결제할 수 없어요. 결제를 다시 시작해 주세요.';
const PAYMENT_DECLINED_MESSAGE = '결제가 완료되지 않았어요. 초안은 그대로 남아 있어요.';
const PROVIDER_PENDING_MESSAGE = '결제 확인이 지연되고 있어요. 잠시 후 다시 시도해 주세요.';

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

const findPendingPayments = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<PaymentRow[]> =>
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
 * POST /api/payments (404 in beta free mode). 409 ALREADY_ENTITLED / FREE_MONTH_AVAILABLE when nothing needs buying. One pending order per user and month is reused (price/provider changes cancel the
 * old one). The amount always comes from PricingConfig.
 */
export const createPayment = async (
  db: Db,
  context: RequestContext,
  body: CreatePaymentRequest,
): Promise<CreatePaymentResponse> => {
  assertPaymentsEnabled();

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

  const { priceKrw, freeMonthLimit } = getPricing(getAppConfig());
  const payment = await db.transaction(async (tx) => {
    // Per-user serialization so concurrent requests cannot create two pending orders.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');

    if (await hasEntitlement(tx, user.id, yearMonth)) {
      throw new ApiError(ApiErrorCode.ALREADY_ENTITLED);
    }

    // A free month would be used on publish anyway: never sell what is free.
    if (getFreeRemaining(await countTrialEntitlements(tx, user.id), freeMonthLimit) > 0) {
      throw new ApiError(ApiErrorCode.FREE_MONTH_AVAILABLE);
    }

    const pending = await findPendingPayments(tx, user.id, yearMonth);
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

  track(AnalyticsEvent.PAYMENT_SHOWN, { actorUserId: user.id, properties: { amount: payment.amount } });

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
 * POST /api/payments/confirm (404 in beta free mode). Month already entitled → 409 ALREADY_ENTITLED without charging. Declines → payment `failed` + 402 PAYMENT_FAILED (drafts and published
 * months untouched). Transient provider errors → 502 PROVIDER_ERROR with the order still pending, so the
 * client can retry and a webhook can still grant it.
 */
export const confirmPayment = async (
  db: Db,
  context: RequestContext,
  body: ConfirmPaymentRequest,
): Promise<ConfirmPaymentResponse> => {
  assertPaymentsEnabled();

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

  // Never charge for a month that is already covered (trial or another order since this one was created).
  if (await hasEntitlement(db, user.id, payment.yearMonth)) {
    await markPaymentCanceled(db, payment.id, PaymentStatus.PENDING);

    throw new ApiError(ApiErrorCode.ALREADY_ENTITLED);
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
    // e.g. virtual account waiting for deposit: the deposit webhook grants it later.
    const [pending] = await db
      .update(payments)
      .set({ providerPaymentKey: result.paymentKey })
      .where(and(eq(payments.id, payment.id), eq(payments.status, PaymentStatus.PENDING)))
      .returning();

    return toConfirmResponse(pending ?? payment);
  }

  if (result.status !== PaymentStatus.PAID) {
    const code = `${NOT_PAID_CODE_PREFIX}${result.status}`;

    await markPaymentFailed(db, payment.id, code);

    return throwDeclined(code);
  }

  return toConfirmResponse((await grantPaidPayment(db, payment.id, result.paymentKey)).payment);
};

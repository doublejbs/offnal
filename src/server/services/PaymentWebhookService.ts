import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { PaymentWebhookEventType } from '@/domain/enums/PaymentWebhookEventType';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type Db } from '@/server/db/Database';
import { paymentEvents, type PaymentRow, payments } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { getPaymentProvider } from '@/server/payment/PaymentFactory';
import { type PaymentProvider } from '@/server/payment/PaymentProvider';
import { grantPaidPayment, markPaymentCanceled, matchesOrder } from '@/server/services/PaymentGrant';

const MAX_EVENT_KEY_LENGTH = 500;
/** Toss sends this header on webhook deliveries; retries of the same delivery reuse it. */
const TOSS_TRANSMISSION_ID_HEADER = 'tosspayments-webhook-transmission-id';
const UUID_SCHEMA = z.uuid();

/** `{ eventType: 'PAYMENT_STATUS_CHANGED', createdAt, data: { paymentKey, orderId, status } }` */
const statusChangedSchema = z.object({
  eventType: z.literal(PaymentWebhookEventType.PAYMENT_STATUS_CHANGED).optional(),
  createdAt: z.string().max(100).optional(),
  data: z.object({
    paymentKey: z.string().min(1).max(200),
    orderId: z.string().min(1).max(64),
    status: z.string().max(50).optional(),
  }),
});

/**
 * Virtual account deposit: `{ createdAt, secret, status, transactionKey, orderId }` at the top level.
 * `secret` is not needed (the payment is re-fetched) and is never stored or logged.
 */
const depositCallbackSchema = z.object({
  eventType: z.literal(PaymentWebhookEventType.DEPOSIT_CALLBACK).optional(),
  createdAt: z.string().max(100).optional(),
  orderId: z.string().min(1).max(64),
  status: z.string().max(50).optional(),
  transactionKey: z.string().max(200).optional(),
});

type WebhookEvent = {
  type: PaymentWebhookEventType;
  orderId: string;
  /** Present for status changes; deposit callbacks are looked up by order ID. */
  paymentKey: string | null;
  eventKey: string;
};

const joinKey = (parts: (string | undefined)[], transmissionId: string | null): string =>
  (transmissionId ?? parts.map((part) => part ?? '').join(':')).slice(0, MAX_EVENT_KEY_LENGTH);

/** Normalizes both Toss payload shapes; anything else is null (ignored with 200). */
export const parseWebhookEvent = (body: unknown, transmissionId: string | null): WebhookEvent | null => {
  const statusChanged = statusChangedSchema.safeParse(body);

  if (statusChanged.success) {
    const { data, createdAt } = statusChanged.data;

    return {
      type: PaymentWebhookEventType.PAYMENT_STATUS_CHANGED,
      orderId: data.orderId,
      paymentKey: data.paymentKey,
      eventKey: joinKey(
        [PaymentWebhookEventType.PAYMENT_STATUS_CHANGED, data.paymentKey, data.status, createdAt],
        transmissionId,
      ),
    };
  }

  const deposit = depositCallbackSchema.safeParse(body);

  if (deposit.success) {
    const { orderId, status, transactionKey, createdAt } = deposit.data;

    return {
      type: PaymentWebhookEventType.DEPOSIT_CALLBACK,
      orderId,
      paymentKey: null,
      eventKey: joinKey(
        [PaymentWebhookEventType.DEPOSIT_CALLBACK, orderId, transactionKey, status, createdAt],
        transmissionId,
      ),
    };
  }

  return null;
};

/** Only events for one of our orders, created with the current provider, are recorded at all. */
const findEventPayment = async (
  db: Db,
  event: WebhookEvent,
  provider: PaymentProvider,
): Promise<PaymentRow | null> => {
  if (!UUID_SCHEMA.safeParse(event.orderId).success) {
    return null;
  }

  const [payment] = await db.select().from(payments).where(eq(payments.id, event.orderId)).limit(1);

  return payment && payment.provider === provider.kind ? payment : null;
};

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

const applyEvent = async (
  db: Db,
  provider: PaymentProvider,
  event: WebhookEvent,
  payment: PaymentRow,
): Promise<void> => {
  // Never trust the payload's status: look the payment up at the provider.
  const fetched = event.paymentKey
    ? await provider.fetchPayment(event.paymentKey)
    : await provider.fetchPaymentByOrderId(payment.id);

  if (!fetched.ok) {
    if (fetched.transient) {
      throw new ApiError(ApiErrorCode.PROVIDER_ERROR);
    }

    return;
  }

  if (!matchesOrder(fetched, payment)) {
    return;
  }

  if (fetched.status === PaymentStatus.PAID) {
    await grantPaidPayment(db, payment.id, fetched.paymentKey);

    return;
  }

  if (fetched.status === PaymentStatus.CANCELED && payment.status === PaymentStatus.PAID) {
    // Canceled/refunded at the provider. The entitlement is kept on purpose: the refund policy
    // (revoke the month or not) is not decided yet (Handoff §3), so only the order status changes.
    await markPaymentCanceled(db, payment.id, PaymentStatus.PAID);
  }
};

/**
 * POST /api/payments/webhook. Unknown, malformed, foreign-provider and duplicate events → 200 no-op
 * (not recorded unless they belong to one of our orders). Transient provider lookups throw (5xx) and
 * leave the event unprocessed so the provider's retry is handled.
 */
export const handlePaymentWebhook = async (db: Db, body: unknown, headers: Headers): Promise<OkResponse> => {
  const event = parseWebhookEvent(body, headers.get(TOSS_TRANSMISSION_ID_HEADER));

  if (!event) {
    return { ok: true };
  }

  const provider = getPaymentProvider();
  const payment = await findEventPayment(db, event, provider);

  if (!payment || !(await recordEvent(db, provider.kind, event.eventKey))) {
    return { ok: true };
  }

  await applyEvent(db, provider, event, payment);
  await markEventProcessed(db, provider.kind, event.eventKey);

  return { ok: true };
};

import { and, eq } from 'drizzle-orm';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { track } from '@/server/analytics/Analytics';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { entitlements, type PaymentRow, payments } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type ProviderPaymentSuccess } from '@/server/payment/PaymentProvider';

/** Paid, but the month already had an entitlement (e.g. trial or another order): money must go back. */
export const DUPLICATE_ENTITLEMENT_CODE = 'DUPLICATE_ENTITLEMENT_REFUND_REQUIRED';

const MAX_FAILURE_CODE_LENGTH = 100;

export type GrantOutcome = {
  payment: PaymentRow;
  /** True only when this call inserted the purchase entitlement. */
  entitlementInserted: boolean;
};

/** orderId, amount and currency of the provider's record must match the stored order exactly. */
export const matchesOrder = (result: ProviderPaymentSuccess, payment: PaymentRow): boolean =>
  result.orderId === payment.id && result.amount === payment.amount && result.currency === payment.currency;

/**
 * Single grant path (confirm and webhook): locks the payment row, marks it paid and inserts the purchase
 * entitlement. Already paid → returned as-is (idempotent). If the month already had an entitlement the
 * order stays paid but is flagged for a refund (failure_code) and logged without PII.
 */
export const grantPaidPayment = async (
  db: Db,
  paymentId: string,
  paymentKey: string,
): Promise<GrantOutcome> => {
  const outcome = await db.transaction(async (tx): Promise<GrantOutcome & { newlyPaid: boolean }> => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');

    if (!locked) {
      throw new ApiError(ApiErrorCode.NOT_FOUND);
    }

    if (locked.status === PaymentStatus.PAID) {
      return { payment: locked, entitlementInserted: false, newlyPaid: false };
    }

    const inserted = await tx
      .insert(entitlements)
      .values({
        userId: locked.userId,
        yearMonth: locked.yearMonth,
        source: EntitlementSource.PURCHASE,
        paymentId: locked.id,
      })
      .onConflictDoNothing()
      .returning({ id: entitlements.id });
    const entitlementInserted = inserted.length > 0;
    const [updated] = await tx
      .update(payments)
      .set({
        status: PaymentStatus.PAID,
        providerPaymentKey: paymentKey,
        failureCode: entitlementInserted ? null : DUPLICATE_ENTITLEMENT_CODE,
        confirmedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    return { payment: updated ?? locked, entitlementInserted, newlyPaid: true };
  });

  if (!outcome.newlyPaid) {
    return { payment: outcome.payment, entitlementInserted: false };
  }

  if (!outcome.entitlementInserted) {
    console.error('[payment] paid without new entitlement', { paymentId });
  }

  track(AnalyticsEvent.PAYMENT_SUCCEEDED, {
    amount: outcome.payment.amount,
    granted: outcome.entitlementInserted,
  });

  return { payment: outcome.payment, entitlementInserted: outcome.entitlementInserted };
};

/** Only a still-pending order is marked failed (a concurrent success must win). */
export const markPaymentFailed = async (
  db: DbExecutor,
  paymentId: string,
  failureCode: string,
): Promise<void> => {
  await db
    .update(payments)
    .set({ status: PaymentStatus.FAILED, failureCode: failureCode.slice(0, MAX_FAILURE_CODE_LENGTH) })
    .where(and(eq(payments.id, paymentId), eq(payments.status, PaymentStatus.PENDING)));
};

/** Cancels an order in the given status (pending orders that must not be charged, refunded paid orders). */
export const markPaymentCanceled = async (
  db: DbExecutor,
  paymentId: string,
  fromStatus: PaymentStatus,
): Promise<void> => {
  await db
    .update(payments)
    .set({ status: PaymentStatus.CANCELED })
    .where(and(eq(payments.id, paymentId), eq(payments.status, fromStatus)));
};

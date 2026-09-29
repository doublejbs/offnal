import { type PaymentStatus } from '@/domain/enums/PaymentStatus';

/** POST /api/payments/confirm — success means the month entitlement now exists. */
export type ConfirmPaymentResponse = {
  orderId: string;
  yearMonth: string;
  status: PaymentStatus;
  draftId: string | null;
};

import { type PaymentClientMode } from '@/domain/enums/PaymentClientMode';
import { type PaymentProviderType } from '@/domain/enums/PaymentProviderType';

/** POST /api/payments — a pending order whose amount is decided by the server. */
export type CreatePaymentResponse = {
  orderId: string;
  amount: number;
  /** Always 'KRW' for now. */
  currency: string;
  /** e.g. '오프날 2026년 12월 이용권' */
  orderName: string;
  yearMonth: string;
  draftId: string | null;
  provider: PaymentProviderType;
  clientConfig: {
    mode: PaymentClientMode;
    /** Toss client key; null for the mock provider. */
    clientKey: string | null;
    /** Stable, non-PII customer key for the provider widget. */
    customerKey: string;
    /** Absolute URLs the provider redirects to (Toss successUrl / failUrl). */
    successUrl: string;
    failUrl: string;
  };
};

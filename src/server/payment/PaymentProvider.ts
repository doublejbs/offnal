import { type PaymentClientMode } from '@/domain/enums/PaymentClientMode';
import { type PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { type PaymentStatus } from '@/domain/enums/PaymentStatus';

export type PaymentClientConfig = {
  /** Toss client key; null for the mock provider. */
  clientKey: string | null;
  mode: PaymentClientMode;
};

export type ConfirmPaymentInput = {
  orderId: string;
  paymentKey: string;
  /** Already checked against the stored order amount by the service. */
  amount: number;
};

export type ProviderPaymentSuccess = {
  ok: true;
  orderId: string;
  paymentKey: string;
  amount: number;
  currency: string;
  /** Provider status mapped to ours (Toss DONE → paid). Only `paid` grants an entitlement. */
  status: PaymentStatus;
};

export type ProviderPaymentFailure = {
  ok: false;
  /** Provider error code (e.g. Toss `REJECT_CARD_PAYMENT`) or TIMEOUT / NETWORK_ERROR / INVALID_RESPONSE. */
  code: string;
  /** Provider message; logged/stored only as the code, never shown verbatim as ours. */
  message: string;
  /** Timeouts, network and 5xx errors: the payment may still succeed, so it must not be marked failed. */
  transient: boolean;
};

export type ProviderPaymentResult = ProviderPaymentSuccess | ProviderPaymentFailure;

/** Server-only payment boundary (Spec §9). Implementations never log keys. */
export type PaymentProvider = {
  readonly kind: PaymentProviderType;
  /** Throws PROVIDER_NOT_CONFIGURED when keys are missing. */
  getClientConfig: () => PaymentClientConfig;
  confirm: (input: ConfirmPaymentInput) => Promise<ProviderPaymentResult>;
  /** Webhook re-lookup: the payload itself is never trusted. */
  fetchPayment: (paymentKey: string) => Promise<ProviderPaymentResult>;
};

import { getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CheckoutResultStage } from '@/domain/enums/CheckoutResultStage';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { type ConfirmPaymentResponse } from '@/domain/types/api/ConfirmPaymentResponse';

export type CheckoutOutcome = {
  stage: CheckoutResultStage;
  shouldPublish: boolean;
  message: string | null;
  providerCode: string | null;
};

const outcome = (
  stage: CheckoutResultStage,
  message: string | null = null,
  providerCode: string | null = null,
): CheckoutOutcome => ({
  stage,
  shouldPublish: stage === CheckoutResultStage.PUBLISHING,
  message,
  providerCode,
});

/** Only a PAID order may lead to publishing; a pending one waits for the deposit webhook. */
export const decideConfirmResult = (response: ConfirmPaymentResponse): CheckoutOutcome => {
  if (response.status === PaymentStatus.PAID) {
    return outcome(CheckoutResultStage.PUBLISHING);
  }

  if (response.status === PaymentStatus.PENDING) {
    return outcome(CheckoutResultStage.PENDING_DEPOSIT);
  }

  return outcome(CheckoutResultStage.PAYMENT_FAILED);
};

export const decideConfirmError = (error: unknown): CheckoutOutcome => {
  if (!isApiClientError(error)) {
    return outcome(CheckoutResultStage.CONFIRM_FAILED, getErrorMessage(error));
  }

  if (error.code === ApiErrorCode.ALREADY_ENTITLED) {
    return outcome(CheckoutResultStage.PUBLISHING);
  }

  if (error.code === ApiErrorCode.PAYMENT_FAILED) {
    const providerCode = typeof error.details?.providerCode === 'string' ? error.details.providerCode : null;

    // Declines carry the provider code; a closed (already failed/canceled) order does not.
    return providerCode
      ? outcome(CheckoutResultStage.PAYMENT_FAILED, error.message, providerCode)
      : outcome(CheckoutResultStage.ORDER_CLOSED, error.message);
  }

  return outcome(CheckoutResultStage.CONFIRM_FAILED, error.message);
};

/** After a successful payment the entitlement exists: only publishing is retried, never the payment. */
export const decidePublishError = (error: unknown): CheckoutOutcome =>
  outcome(CheckoutResultStage.PUBLISH_FAILED, getErrorMessage(error));

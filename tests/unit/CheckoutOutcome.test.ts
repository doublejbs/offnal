import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/client/ApiClient';
import { decideConfirmError, decideConfirmResult, decidePublishError } from '@/client/CheckoutOutcome';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CheckoutResultStage } from '@/domain/enums/CheckoutResultStage';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';

const confirmed = (status: PaymentStatus) => ({ orderId: 'o', yearMonth: '2026-12', status, draftId: 'd' });

describe('CheckoutOutcome', () => {
  it('publishes only after a PAID confirm', () => {
    expect(decideConfirmResult(confirmed(PaymentStatus.PAID))).toEqual({
      stage: CheckoutResultStage.PUBLISHING,
      shouldPublish: true,
      message: null,
      providerCode: null,
    });
  });

  it('shows a deposit-pending state (no publish) for pending payments', () => {
    const outcome = decideConfirmResult(confirmed(PaymentStatus.PENDING));

    expect(outcome.stage).toBe(CheckoutResultStage.PENDING_DEPOSIT);
    expect(outcome.shouldPublish).toBe(false);
  });

  it('treats other statuses as a failed payment', () => {
    expect(decideConfirmResult(confirmed(PaymentStatus.FAILED)).stage).toBe(
      CheckoutResultStage.PAYMENT_FAILED,
    );
    expect(decideConfirmResult(confirmed(PaymentStatus.CANCELED)).shouldPublish).toBe(false);
  });

  it('publishes directly when the month is already entitled', () => {
    const outcome = decideConfirmError(new ApiClientError(409, ApiErrorCode.ALREADY_ENTITLED, '이미'));

    expect(outcome).toMatchObject({ stage: CheckoutResultStage.PUBLISHING, shouldPublish: true });
  });

  it('shows the server message and provider code for a declined payment', () => {
    const outcome = decideConfirmError(
      new ApiClientError(402, ApiErrorCode.PAYMENT_FAILED, '결제가 완료되지 않았어요.', {
        providerCode: 'REJECT_CARD_COMPANY',
      }),
    );

    expect(outcome).toEqual({
      stage: CheckoutResultStage.PAYMENT_FAILED,
      shouldPublish: false,
      message: '결제가 완료되지 않았어요.',
      providerCode: 'REJECT_CARD_COMPANY',
    });
  });

  it('distinguishes a closed order (PAYMENT_FAILED without a provider code)', () => {
    const outcome = decideConfirmError(
      new ApiClientError(402, ApiErrorCode.PAYMENT_FAILED, '이 주문은 더 이상 결제할 수 없어요.'),
    );

    expect(outcome.stage).toBe(CheckoutResultStage.ORDER_CLOSED);
    expect(outcome.message).toBe('이 주문은 더 이상 결제할 수 없어요.');
  });

  it('keeps provider delays and network errors retryable', () => {
    expect(decideConfirmError(new ApiClientError(502, ApiErrorCode.PROVIDER_ERROR, '지연')).stage).toBe(
      CheckoutResultStage.CONFIRM_FAILED,
    );
    expect(decideConfirmError(new ApiClientError(0, null, 'offline')).stage).toBe(
      CheckoutResultStage.CONFIRM_FAILED,
    );
    expect(decideConfirmError(new Error('boom')).stage).toBe(CheckoutResultStage.CONFIRM_FAILED);
  });

  it('never asks for a new payment when publishing fails after payment', () => {
    const outcome = decidePublishError(
      new ApiClientError(422, ApiErrorCode.PUBLISH_BLOCKED, '확인이 필요해요'),
    );

    expect(outcome).toEqual({
      stage: CheckoutResultStage.PUBLISH_FAILED,
      shouldPublish: false,
      message: '확인이 필요해요',
      providerCode: null,
    });
  });
});

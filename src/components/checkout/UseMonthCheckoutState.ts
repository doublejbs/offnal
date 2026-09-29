'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { createPayment, getCalendarSummary, getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { publishDraftById } from '@/client/DraftPublishing';
import { mountTossCheckout, type TossCheckoutHandle } from '@/client/TossCheckout';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CheckoutStage } from '@/domain/enums/CheckoutStage';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { type CreatePaymentResponse } from '@/domain/types/api/CreatePaymentResponse';

/** Mock result: both outcomes go through the server confirm (mock_fail_* is declined there). */
export const buildMockResultHref = (
  payment: CreatePaymentResponse,
  draftId: string | null,
  isSuccess: boolean,
): string => {
  const params = new URLSearchParams({
    paymentKey: `${isSuccess ? 'mock_success' : 'mock_fail'}_${payment.orderId}`,
    orderId: payment.orderId,
    amount: String(payment.amount),
  });

  if (draftId) {
    params.set('draftId', draftId);
  }

  return `/checkout/${payment.yearMonth}/result?${params.toString()}`;
};

const toStageForError = (error: unknown): CheckoutStage => {
  if (isApiClientError(error) && error.code === ApiErrorCode.FREE_MONTH_AVAILABLE) {
    return CheckoutStage.FREE_MONTH_AVAILABLE;
  }

  if (isApiClientError(error) && error.code === ApiErrorCode.ALREADY_ENTITLED) {
    return CheckoutStage.ENTITLED;
  }

  if (isApiClientError(error) && error.code === ApiErrorCode.AUTH_REQUIRED) {
    return CheckoutStage.AUTH_REQUIRED;
  }

  return CheckoutStage.ERROR;
};

/**
 * The order is created (or the pending one reused) on entry, so "nothing to buy" cases are handled before
 * any pay button appears: a free month goes back to the draft, an entitled month publishes directly.
 */
export const useMonthCheckoutState = (yearMonth: string, draftId: string | null) => {
  const router = useRouter();
  const widgetId = useId();
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState(CheckoutStage.CREATING);
  const [payment, setPayment] = useState<CreatePaymentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
  const tossRef = useRef<TossCheckoutHandle | null>(null);
  const methodsId = `${widgetId}-methods`;
  const agreementId = `${widgetId}-agreement`;

  useEffect(() => {
    const controller = new AbortController();

    getCalendarSummary(controller.signal)
      .then((summary) => setFreeRemaining(summary.freeRemaining))
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  useEffect(() => {
    let isActive = true;

    const handleEntitled = async () => {
      if (!draftId) {
        router.replace(`/calendar/${yearMonth}`);

        return;
      }

      try {
        router.replace(`/calendar/${await publishDraftById(draftId)}`);
      } catch (caught: unknown) {
        if (isActive) {
          setError(`이미 이용권이 있는 달이지만 저장하지 못했어요. ${getErrorMessage(caught)}`);
        }
      }
    };

    createPayment(draftId ? { yearMonth, draftId } : { yearMonth })
      .then((created) => {
        if (!isActive) {
          return;
        }

        setPayment(created);
        setStage(
          created.provider === PaymentProviderType.MOCK
            ? CheckoutStage.MOCK_READY
            : CheckoutStage.TOSS_LOADING,
        );
      })
      .catch((caught: unknown) => {
        if (!isActive) {
          return;
        }

        const next = toStageForError(caught);

        setStage(next);
        setError(next === CheckoutStage.ERROR ? getErrorMessage(caught) : null);

        if (next === CheckoutStage.ENTITLED) {
          void handleEntitled();
        }
      });

    return () => {
      isActive = false;
    };
  }, [attempt, draftId, router, yearMonth]);

  useEffect(() => {
    if (stage !== CheckoutStage.TOSS_LOADING || !payment) {
      return;
    }

    let isActive = true;

    mountTossCheckout(payment, {
      methods: `#${CSS.escape(methodsId)}`,
      agreement: `#${CSS.escape(agreementId)}`,
    })
      .then((handle) => {
        if (isActive) {
          tossRef.current = handle;
          setStage(CheckoutStage.TOSS_READY);
        }
      })
      .catch((caught: unknown) => {
        if (isActive) {
          setError(caught instanceof Error ? caught.message : '결제 화면을 불러오지 못했어요.');
          setStage(CheckoutStage.ERROR);
        }
      });

    return () => {
      isActive = false;
    };
  }, [agreementId, methodsId, payment, stage]);

  const handleRetry = () => {
    setError(null);
    setStage(CheckoutStage.CREATING);
    setAttempt((value) => value + 1);
  };

  const handleMockResult = (isSuccess: boolean) => {
    if (payment) {
      // replace: Back must not return to a pay button for an order that is already decided.
      router.replace(buildMockResultHref(payment, draftId, isSuccess));
    }
  };

  const handleTossPay = async () => {
    if (!tossRef.current) {
      return;
    }

    setStage(CheckoutStage.REQUESTING);

    try {
      await tossRef.current.requestPayment();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '결제를 시작하지 못했어요.');
      setStage(CheckoutStage.TOSS_READY);
    }
  };

  return {
    stage,
    payment,
    error,
    freeRemaining,
    methodsId,
    agreementId,
    handleRetry,
    handleMockResult,
    handleTossPay,
  };
};

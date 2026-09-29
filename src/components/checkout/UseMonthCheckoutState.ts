'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createPayment, getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { mountTossCheckout, type TossCheckoutHandle } from '@/client/TossCheckout';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CheckoutStage } from '@/domain/enums/CheckoutStage';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { type CreatePaymentResponse } from '@/domain/types/api/CreatePaymentResponse';

export const TOSS_METHODS_ID = 'toss-payment-methods';
export const TOSS_AGREEMENT_ID = 'toss-agreement';

const buildResultHref = (
  payment: CreatePaymentResponse,
  draftId: string | null,
  isSuccess: boolean,
): string => {
  const params = new URLSearchParams({
    paymentKey: `${isSuccess ? 'mock_success' : 'mock_fail'}_${payment.orderId}`,
    orderId: payment.orderId,
    amount: String(payment.amount),
  });

  if (!isSuccess) {
    params.set('status', 'fail');
    params.set('code', 'MOCK_PAYMENT_FAILED');
  }

  if (draftId) {
    params.set('draftId', draftId);
  }

  return `/checkout/${payment.yearMonth}/result?${params.toString()}`;
};

export const useMonthCheckoutState = (yearMonth: string, draftId: string | null) => {
  const router = useRouter();
  const [stage, setStage] = useState(CheckoutStage.IDLE);
  const [payment, setPayment] = useState<CreatePaymentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const tossRef = useRef<TossCheckoutHandle | null>(null);

  useEffect(() => {
    if (stage !== CheckoutStage.TOSS_LOADING || !payment) {
      return;
    }

    let isActive = true;

    mountTossCheckout(payment, { methods: `#${TOSS_METHODS_ID}`, agreement: `#${TOSS_AGREEMENT_ID}` })
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
  }, [payment, stage]);

  const handleStart = async () => {
    setStage(CheckoutStage.CREATING);
    setError(null);

    try {
      const created = await createPayment(draftId ? { yearMonth, draftId } : { yearMonth });

      setPayment(created);
      setStage(
        created.provider === PaymentProviderType.MOCK ? CheckoutStage.MOCK_READY : CheckoutStage.TOSS_LOADING,
      );
    } catch (caught: unknown) {
      if (isApiClientError(caught) && caught.code === ApiErrorCode.ALREADY_ENTITLED) {
        setStage(CheckoutStage.ALREADY_ENTITLED);

        return;
      }

      if (isApiClientError(caught) && caught.code === ApiErrorCode.AUTH_REQUIRED) {
        setIsAuthRequired(true);
      }

      setError(
        isApiClientError(caught) && caught.status === 404
          ? '결제 기능을 아직 사용할 수 없어요. 잠시 후 다시 시도해 주세요.'
          : getErrorMessage(caught),
      );
      setStage(CheckoutStage.ERROR);
    }
  };

  const handleMockResult = (isSuccess: boolean) => {
    if (payment) {
      router.push(buildResultHref(payment, draftId, isSuccess));
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

  return { stage, payment, error, isAuthRequired, handleStart, handleMockResult, handleTossPay };
};

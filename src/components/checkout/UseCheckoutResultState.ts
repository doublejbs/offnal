'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  confirmPayment,
  getDraft,
  getErrorMessage,
  isApiClientError,
  publishDraft,
} from '@/client/ApiClient';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CheckoutResultStage } from '@/domain/enums/CheckoutResultStage';
import { DraftStatus } from '@/domain/enums/DraftStatus';

export type CheckoutResultQuery = {
  yearMonth: string;
  paymentKey: string | null;
  orderId: string | null;
  amount: string | null;
  isFailure: boolean;
  draftId: string | null;
};

/**
 * Provider redirect → server confirm (the only source of truth) → publish the draft → calendar.
 * Confirm is idempotent; a publish failure after payment retries publish only (never re-payment).
 */
export const useCheckoutResultState = (query: CheckoutResultQuery) => {
  const router = useRouter();
  const isInvalid = !query.isFailure && (!query.paymentKey || !query.orderId || !query.amount);
  const [stage, setStage] = useState(
    query.isFailure || isInvalid ? CheckoutResultStage.PAYMENT_FAILED : CheckoutResultStage.CONFIRMING,
  );
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(query.draftId);
  const hasStartedRef = useRef(false);

  const publish = useCallback(
    async (targetDraftId: string | null) => {
      if (!targetDraftId) {
        setStage(CheckoutResultStage.DONE);

        return;
      }

      setStage(CheckoutResultStage.PUBLISHING);
      setError(null);

      try {
        const { draft } = await getDraft(targetDraftId);

        if (draft.status !== DraftStatus.PUBLISHED) {
          await publishDraft(targetDraftId, draft.revision);
        }

        router.replace(`/calendar/${draft.yearMonth}`);
      } catch (caught: unknown) {
        setError(getErrorMessage(caught));
        setStage(CheckoutResultStage.PUBLISH_FAILED);
      }
    },
    [router],
  );

  const confirm = useCallback(async () => {
    if (!query.paymentKey || !query.orderId || !query.amount) {
      return;
    }

    setStage(CheckoutResultStage.CONFIRMING);
    setError(null);

    try {
      const result = await confirmPayment({
        orderId: query.orderId,
        paymentKey: query.paymentKey,
        amount: Number(query.amount),
      });
      const target = result.draftId ?? query.draftId;

      setDraftId(target);
      await publish(target);
    } catch (caught: unknown) {
      if (isApiClientError(caught) && caught.code === ApiErrorCode.PAYMENT_FAILED) {
        setStage(CheckoutResultStage.PAYMENT_FAILED);

        return;
      }

      setError(getErrorMessage(caught));
      setStage(CheckoutResultStage.CONFIRM_FAILED);
    }
  }, [publish, query.amount, query.draftId, query.orderId, query.paymentKey]);

  useEffect(() => {
    if (query.isFailure || isInvalid) {
      return;
    }

    // Deferred so a Strict Mode re-mount cancels the first timer instead of confirming twice.
    const timer = window.setTimeout(() => {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        void confirm();
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [confirm, isInvalid, query.isFailure]);

  const handleRetryPublish = () => void publish(draftId);
  const handleRetryConfirm = () => void confirm();

  return { stage, error, draftId, handleRetryPublish, handleRetryConfirm };
};

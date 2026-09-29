'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { confirmPayment } from '@/client/ApiClient';
import {
  type CheckoutOutcome,
  decideConfirmError,
  decideConfirmResult,
  decidePublishError,
} from '@/client/CheckoutOutcome';
import { publishDraftById } from '@/client/DraftPublishing';
import { CheckoutResultStage } from '@/domain/enums/CheckoutResultStage';

export type CheckoutResultQuery = {
  yearMonth: string;
  paymentKey: string | null;
  orderId: string | null;
  amount: string | null;
  /** Provider fail redirect (Toss failUrl adds status=fail&code&message). */
  isFailure: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  draftId: string | null;
};

const initialOutcome = (query: CheckoutResultQuery): CheckoutOutcome => {
  if (query.isFailure || !query.paymentKey || !query.orderId || !query.amount) {
    return {
      stage: CheckoutResultStage.PAYMENT_FAILED,
      shouldPublish: false,
      message: query.failureMessage,
      providerCode: query.failureCode,
    };
  }

  return { stage: CheckoutResultStage.CONFIRMING, shouldPublish: false, message: null, providerCode: null };
};

/**
 * Provider redirect → server confirm (the only source of truth) → publish → calendar. Confirm is
 * idempotent; after a payment only publishing is retried (never the payment).
 */
export const useCheckoutResultState = (query: CheckoutResultQuery) => {
  const router = useRouter();
  const [outcome, setOutcome] = useState<CheckoutOutcome>(() => initialOutcome(query));
  const [draftId, setDraftId] = useState<string | null>(query.draftId);
  const hasStartedRef = useRef(false);
  const shouldConfirm = outcome.stage === CheckoutResultStage.CONFIRMING;

  const publish = useCallback(
    async (targetDraftId: string | null) => {
      if (!targetDraftId) {
        setOutcome({
          stage: CheckoutResultStage.DONE,
          shouldPublish: false,
          message: null,
          providerCode: null,
        });

        return;
      }

      setOutcome({
        stage: CheckoutResultStage.PUBLISHING,
        shouldPublish: false,
        message: null,
        providerCode: null,
      });

      try {
        router.replace(`/calendar/${await publishDraftById(targetDraftId)}`);
      } catch (error: unknown) {
        setOutcome(decidePublishError(error));
      }
    },
    [router],
  );

  const confirm = useCallback(async () => {
    const { paymentKey, orderId, amount } = query;

    if (!paymentKey || !orderId || !amount) {
      return;
    }

    setOutcome({
      stage: CheckoutResultStage.CONFIRMING,
      shouldPublish: false,
      message: null,
      providerCode: null,
    });

    let next: CheckoutOutcome;
    let target = query.draftId;

    try {
      const result = await confirmPayment({ orderId, paymentKey, amount: Number(amount) });

      target = result.draftId ?? query.draftId;
      next = decideConfirmResult(result);
    } catch (error: unknown) {
      next = decideConfirmError(error);
    }

    setDraftId(target);

    if (next.shouldPublish) {
      await publish(target);

      return;
    }

    setOutcome(next);
  }, [publish, query]);

  useEffect(() => {
    if (!shouldConfirm) {
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
  }, [confirm, shouldConfirm]);

  return {
    outcome,
    draftId,
    handleRetryPublish: () => void publish(draftId),
    handleRetryConfirm: () => void confirm(),
  };
};

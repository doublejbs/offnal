'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  claimRecognition,
  getRecognitionStatus,
  isApiClientError,
  processRecognition,
} from '@/client/ApiClient';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { RecognitionViewMode } from '@/domain/enums/RecognitionViewMode';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';

const POLL_INTERVAL_MS = 2000;
const DELAY_NOTICE_MS = 15_000;

export type RecognitionState = {
  mode: RecognitionViewMode;
  status: RecognitionStatusResponse | null;
  isDelayed: boolean;
  claimError: string | null;
  handleRetry: () => void;
};

const toMode = (status: RecognitionStatusResponse): RecognitionViewMode => {
  if (status.status === RecognitionStatus.RECOGNIZED) {
    return status.ownerAuthenticated ? RecognitionViewMode.CLAIMING : RecognitionViewMode.GATE;
  }

  if (status.status === RecognitionStatus.FAILED) {
    return RecognitionViewMode.FAILED;
  }

  if (status.status === RecognitionStatus.EXPIRED) {
    return RecognitionViewMode.EXPIRED;
  }

  return RecognitionViewMode.PROGRESS;
};

const isTerminal = (mode: RecognitionViewMode): boolean => mode !== RecognitionViewMode.PROGRESS;

/**
 * Fires `process` (not awaited by the UI) and polls `status` every 2s. While a `process` call is in
 * flight, a stale `failed` from polling is ignored so a retry never flashes the old failure.
 */
export const useRecognitionState = (id: string): RecognitionState => {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState(RecognitionViewMode.LOADING);
  const [status, setStatus] = useState<RecognitionStatusResponse | null>(null);
  const [isDelayed, setIsDelayed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const claimStartedRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    let isFinished = false;
    let isProcessInFlight = true;
    let pollTimer: number | undefined;

    const apply = (next: RecognitionStatusResponse, fromProcess: boolean) => {
      const nextMode = toMode(next);

      if (!isActive || isFinished) {
        return;
      }

      if (!fromProcess && isProcessInFlight && nextMode === RecognitionViewMode.FAILED) {
        return;
      }

      setStatus(next);
      setMode(nextMode);
      isFinished = isTerminal(nextMode);
    };

    const poll = async () => {
      try {
        apply(await getRecognitionStatus(id, controller.signal), false);
      } catch (error: unknown) {
        if (isActive && isApiClientError(error) && error.status === 404) {
          isFinished = true;
          setMode(RecognitionViewMode.NOT_FOUND);
        }
      }

      if (isActive && !isFinished) {
        pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    processRecognition(id)
      .then((next) => {
        isProcessInFlight = false;
        apply(next, true);
      })
      .catch(() => {
        // Network drops and timeouts are expected on long runs; polling reports the real state.
        isProcessInFlight = false;
      });
    void poll();

    const delayTimer = window.setTimeout(() => {
      if (isActive) {
        setIsDelayed(true);
      }
    }, DELAY_NOTICE_MS);

    return () => {
      isActive = false;
      // Stops the status poll; the process request is left running on purpose (the server keeps going).
      controller.abort();
      window.clearTimeout(pollTimer);
      window.clearTimeout(delayTimer);
    };
  }, [id, attempt]);

  useEffect(() => {
    if (mode !== RecognitionViewMode.CLAIMING || claimStartedRef.current) {
      return;
    }

    claimStartedRef.current = true;
    claimRecognition(id)
      .then(() => router.replace(`/recognitions/${id}/select`))
      .catch((error: unknown) => {
        claimStartedRef.current = false;

        if (isApiClientError(error) && error.code === ApiErrorCode.EXPIRED) {
          setMode(RecognitionViewMode.EXPIRED);

          return;
        }

        if (isApiClientError(error) && error.status === 404) {
          setMode(RecognitionViewMode.NOT_FOUND);

          return;
        }

        setClaimError(isApiClientError(error) ? error.message : '로그인한 계정에 연결하지 못했어요.');
      });
  }, [id, mode, router]);

  const handleRetry = () => {
    setClaimError(null);
    setIsDelayed(false);
    setMode(RecognitionViewMode.PROGRESS);
    setAttempt((value) => value + 1);
  };

  return { mode, status, isDelayed, claimError, handleRetry };
};

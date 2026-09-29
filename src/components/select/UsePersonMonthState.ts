'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

import { extractRecognition, getCandidates, getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { type CandidatesResponse } from '@/domain/types/api/CandidatesResponse';
import { currentYearMonthInSeoul, isValidYearMonth } from '@/domain/YearMonth';

export type PersonMonthState = {
  loadState: ScreenLoadState;
  loadError: string | null;
  data: CandidatesResponse | null;
  yearMonth: string;
  selectedRowId: string | null;
  isManual: boolean;
  manualName: string;
  isSubmitting: boolean;
  submitError: string | null;
  canSubmit: boolean;
  setYearMonth: (value: string) => void;
  setSelectedRowId: (value: string) => void;
  setManualName: (value: string) => void;
  handleToggleManual: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

const toLoadState = (error: unknown): ScreenLoadState => {
  if (!isApiClientError(error)) {
    return ScreenLoadState.ERROR;
  }

  if (error.code === ApiErrorCode.AUTH_REQUIRED) {
    return ScreenLoadState.AUTH_REQUIRED;
  }

  if (error.code === ApiErrorCode.EXPIRED) {
    return ScreenLoadState.EXPIRED;
  }

  if (error.status === 404) {
    return ScreenLoadState.NOT_FOUND;
  }

  return ScreenLoadState.ERROR;
};

export const usePersonMonthState = (recognitionId: string): PersonMonthState => {
  const router = useRouter();
  const [loadState, setLoadState] = useState(ScreenLoadState.LOADING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [yearMonth, setYearMonth] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    getCandidates(recognitionId)
      .then((response) => {
        if (!isActive) {
          return;
        }

        setData(response);
        setYearMonth(response.yearMonthGuess ?? currentYearMonthInSeoul(new Date()));
        setLoadState(ScreenLoadState.READY);
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        if (isApiClientError(error) && error.code === ApiErrorCode.RECOGNITION_NOT_READY) {
          router.replace(`/recognitions/${recognitionId}`);

          return;
        }

        setLoadError(getErrorMessage(error));
        setLoadState(toLoadState(error));
      });

    return () => {
      isActive = false;
    };
  }, [recognitionId, router]);

  const trimmedName = manualName.trim();
  const hasPerson = isManual
    ? trimmedName.length > 0 && trimmedName.length <= MAX_DISPLAY_NAME_LENGTH
    : selectedRowId !== null;
  const canSubmit = isValidYearMonth(yearMonth) && hasPerson && !isSubmitting;

  const handleToggleManual = () => {
    setSubmitError(null);
    setIsManual((value) => !value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      setSubmitError(isValidYearMonth(yearMonth) ? '내 이름을 선택해 주세요.' : '대상 월을 확인해 주세요.');

      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const body =
        isManual || selectedRowId === null
          ? { manualName: trimmedName, yearMonth }
          : { rowId: selectedRowId, yearMonth };
      const { draftId } = await extractRecognition(recognitionId, body);

      router.push(`/drafts/${draftId}`);
    } catch (error: unknown) {
      setIsSubmitting(false);
      setSubmitError(getErrorMessage(error));
    }
  };

  return {
    loadState,
    loadError,
    data,
    yearMonth,
    selectedRowId,
    isManual,
    manualName,
    isSubmitting,
    submitError,
    canSubmit,
    setYearMonth,
    setSelectedRowId,
    setManualName,
    handleToggleManual,
    handleSubmit,
  };
};

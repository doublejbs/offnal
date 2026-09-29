'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

import { extractRecognition, getCandidates, getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { useLoad } from '@/components/UseLoad';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { currentYearMonthInSeoul, isValidYearMonth } from '@/domain/YearMonth';

export const usePersonMonthState = (recognitionId: string) => {
  const router = useRouter();
  const candidates = useLoad(recognitionId, (signal) => getCandidates(recognitionId, signal));
  const [yearMonthInput, setYearMonth] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data, error } = candidates;
  const isNotReady = isApiClientError(error) && error.code === ApiErrorCode.RECOGNITION_NOT_READY;
  const yearMonth = yearMonthInput ?? data?.yearMonthGuess ?? currentYearMonthInSeoul(new Date());
  // Extraction needs the original photo: once it is deleted only a new upload can continue.
  const isSourceGone = data !== null && !data.sourceAvailable;

  useEffect(() => {
    if (isNotReady) {
      router.replace(`/recognitions/${recognitionId}`);
    }
  }, [isNotReady, recognitionId, router]);

  const trimmedName = manualName.trim();
  const hasPerson = isManual
    ? trimmedName.length > 0 && trimmedName.length <= MAX_DISPLAY_NAME_LENGTH
    : selectedRowId !== null;
  const canSubmit = isValidYearMonth(yearMonth) && hasPerson && !isSubmitting && !isSourceGone;

  const handleToggleManual = () => {
    setSubmitError(null);
    setIsManual((value) => !value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
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
    } catch (caught: unknown) {
      setIsSubmitting(false);
      setSubmitError(getErrorMessage(caught));
    }
  };

  return {
    candidates,
    isNotReady,
    isSourceGone,
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

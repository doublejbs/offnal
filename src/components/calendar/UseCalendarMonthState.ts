'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  deleteCalendarMonth,
  editCalendarMonth,
  getCalendarMonth,
  getCalendarSummary,
  getErrorMessage,
  isApiClientError,
  updateShareSettings,
} from '@/client/ApiClient';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { todayInSeoul, yearMonthOfDate } from '@/domain/YearMonth';

const pickInitialDate = (month: CalendarMonthResponse): string | null => {
  const today = todayInSeoul(new Date());

  if (yearMonthOfDate(today) === month.yearMonth) {
    return today;
  }

  return month.entries[0]?.date ?? null;
};

const toLoadState = (error: unknown): ScreenLoadState => {
  if (isApiClientError(error) && error.code === ApiErrorCode.AUTH_REQUIRED) {
    return ScreenLoadState.AUTH_REQUIRED;
  }

  if (isApiClientError(error) && error.status === 404) {
    return ScreenLoadState.NOT_FOUND;
  }

  return ScreenLoadState.ERROR;
};

export const useCalendarMonthState = (yearMonth: string) => {
  const router = useRouter();
  const [loadState, setLoadState] = useState(ScreenLoadState.LOADING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CalendarSummaryResponse | null>(null);
  const [month, setMonth] = useState<CalendarMonthResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSharingMonth, setIsSharingMonth] = useState(false);

  useEffect(() => {
    let isActive = true;

    Promise.all([getCalendarSummary(), getCalendarMonth(yearMonth)])
      .then(([nextSummary, nextMonth]) => {
        if (!isActive) {
          return;
        }

        setSummary(nextSummary);
        setMonth(nextMonth);
        setSelectedDate(pickInitialDate(nextMonth));
        setLoadState(ScreenLoadState.READY);
      })
      .catch(async (error: unknown) => {
        if (!isActive) {
          return;
        }

        // Keep the month list for the "not published" state.
        const fallback = await getCalendarSummary().catch(() => null);

        setSummary(fallback);
        setLoadError(getErrorMessage(error));
        setLoadState(toLoadState(error));
      });

    return () => {
      isActive = false;
    };
  }, [yearMonth]);

  const handleChangeMonth = (next: string) => router.push(`/calendar/${next}`);

  const handleEdit = async () => {
    setIsEditing(true);
    setActionError(null);

    try {
      const { draftId } = await editCalendarMonth(yearMonth);

      router.push(`/drafts/${draftId}`);
    } catch (error: unknown) {
      setIsEditing(false);
      setActionError(getErrorMessage(error));
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      await deleteCalendarMonth(yearMonth);
      router.replace('/calendar');
      router.refresh();
    } catch (error: unknown) {
      setIsDeleting(false);
      setIsDeleteOpen(false);
      setActionError(getErrorMessage(error));
    }
  };

  /** Adds this month to the existing link's visible months (sharing a new month is always explicit). */
  const handleShareThisMonth = async () => {
    if (!summary || !month) {
      return;
    }

    setIsSharingMonth(true);
    setActionError(null);

    try {
      const visibleMonths = summary.months.filter((item) => item.shareVisible).map((item) => item.yearMonth);

      await updateShareSettings({
        displayName: summary.share.displayName ?? month.displayName,
        visibleMonths: [...new Set([...visibleMonths, yearMonth])],
      });
      setMonth({ ...month, shareVisible: true });
      setSummary({
        ...summary,
        months: summary.months.map((item) =>
          item.yearMonth === yearMonth ? { ...item, shareVisible: true } : item,
        ),
      });
    } catch (error: unknown) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsSharingMonth(false);
    }
  };

  return {
    loadState,
    loadError,
    summary,
    month,
    selectedDate,
    actionError,
    isEditing,
    isDeleteOpen,
    isDeleting,
    isSharingMonth,
    setSelectedDate,
    setIsDeleteOpen,
    handleChangeMonth,
    handleEdit,
    handleDelete,
    handleShareThisMonth,
  };
};

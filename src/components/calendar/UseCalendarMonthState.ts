'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  deleteCalendarMonth,
  editCalendarMonth,
  getCalendarMonth,
  getCalendarSummary,
  getErrorMessage,
  updateShareSettings,
} from '@/client/ApiClient';
import { useLoad } from '@/components/UseLoad';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { todayInSeoul, yearMonthOfDate } from '@/domain/YearMonth';

const pickInitialDate = (month: CalendarMonthResponse): string | null => {
  const today = todayInSeoul(new Date());

  return yearMonthOfDate(today) === month.yearMonth ? today : (month.entries[0]?.date ?? null);
};

export const useCalendarMonthState = (yearMonth: string) => {
  const router = useRouter();
  const summary = useLoad('calendar-summary', (signal) => getCalendarSummary(signal));
  const month = useLoad(yearMonth, (signal) => getCalendarMonth(yearMonth, signal));
  const [pickedDate, setSelectedDate] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSharingMonth, setIsSharingMonth] = useState(false);
  const selectedDate = pickedDate ?? (month.data ? pickInitialDate(month.data) : null);
  const loadState =
    month.state === ScreenLoadState.READY && summary.state !== ScreenLoadState.READY
      ? summary.state
      : month.state;

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
    if (!summary.data || !month.data) {
      return;
    }

    setIsSharingMonth(true);
    setActionError(null);

    try {
      const visibleMonths = summary.data.months
        .filter((item) => item.shareVisible)
        .map((item) => item.yearMonth);

      await updateShareSettings({
        displayName: summary.data.share.displayName ?? month.data.displayName,
        visibleMonths: [...new Set([...visibleMonths, yearMonth])],
      });
      month.setData({ ...month.data, shareVisible: true });
      summary.setData({
        ...summary.data,
        months: summary.data.months.map((item) =>
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
    loadError: month.errorMessage ?? summary.errorMessage,
    summary: summary.data,
    month: month.data,
    selectedDate,
    actionError,
    isEditing,
    isDeleteOpen,
    isDeleting,
    isSharingMonth,
    setSelectedDate,
    setIsDeleteOpen,
    handleReload: () => {
      summary.reload();
      month.reload();
    },
    handleChangeMonth,
    handleEdit,
    handleDelete,
    handleShareThisMonth,
  };
};

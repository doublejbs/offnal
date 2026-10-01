'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  deleteCalendarMonth,
  editCalendarMonth,
  getCalendarMonth,
  getCalendarSummary,
  getErrorMessage,
  isApiClientError,
  updateShareSettings,
} from '@/client/ApiClient';
import { ackTeamChanges } from '@/client/TeamApiClient';
import { useLoad } from '@/components/UseLoad';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { todayInSeoul, yearMonthOfDate } from '@/domain/YearMonth';

const TEAM_READ_ONLY_MESSAGE =
  '팀 근무표로 받은 달이라 직접 고치거나 삭제할 수 없어요. 틀린 곳이 있으면 팀 관리자에게 수정을 요청해 주세요.';

const isTeamReadOnly = (error: unknown): boolean =>
  isApiClientError(error) && error.code === ApiErrorCode.TEAM_MONTH_READ_ONLY;

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
  const [isAcking, setIsAcking] = useState(false);
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
      setActionError(isTeamReadOnly(error) ? TEAM_READ_ONLY_MESSAGE : getErrorMessage(error));

      if (isTeamReadOnly(error)) {
        month.reload();
      }
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
      setActionError(isTeamReadOnly(error) ? TEAM_READ_ONLY_MESSAGE : getErrorMessage(error));

      if (isTeamReadOnly(error)) {
        month.reload();
      }
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

  /** "확인했어요": hides the "변경" marks up to the current team revision. */
  const handleAckChanges = async () => {
    const team = month.data?.team;

    if (!month.data || !team) {
      return;
    }

    setIsAcking(true);
    setActionError(null);

    try {
      const acked = await ackTeamChanges(team.teamId, { yearMonth, revision: team.revision });

      month.setData({
        ...month.data,
        team: { ...team, changes: [], acknowledgedRevision: acked.acknowledgedRevision },
      });
    } catch (error: unknown) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsAcking(false);
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
    isAcking,
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
    handleAckChanges,
  };
};

'use client';

import { useState } from 'react';

import {
  getErrorMessage,
  getShareSettings,
  rotateShareLink,
  stopSharing,
  updateShareSettings,
} from '@/client/ApiClient';
import { SHARE_LINK_OUTCOME_MESSAGES } from '@/client/ShareOutcomeMessages';
import { getBrowserShareEnvironment, shareOrCopyLink } from '@/client/ShareOrDownload';
import { useLoad } from '@/components/UseLoad';
import { ShareConfirmAction } from '@/domain/enums/ShareConfirmAction';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';

/**
 * Months checked by default: the server keeps month visibility even while sharing is off, so a
 * re-enabled link shows the same months again; with none, only the current month.
 */
const defaultVisibleMonths = (settings: ShareSettingsResponse, yearMonth: string): string[] => {
  const kept = settings.visibleMonths.filter((month) => settings.availableMonths.includes(month));

  return kept.length > 0 ? kept : [yearMonth];
};

export const useShareSettingsState = (yearMonth: string, fallbackName: string) => {
  const settingsLoad = useLoad('share-settings', (signal) => getShareSettings(signal));
  const [displayNameInput, setDisplayName] = useState<string | null>(null);
  const [visibleMonthsInput, setVisibleMonths] = useState<string[] | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState(ShareConfirmAction.NONE);
  const settings = settingsLoad.data;
  const displayName = displayNameInput ?? (settings?.displayName || fallbackName);
  const visibleMonths =
    visibleMonthsInput ?? (settings ? defaultVisibleMonths(settings, yearMonth) : [yearMonth]);
  const canShare = Boolean(getBrowserShareEnvironment().share);

  const handleToggleMonth = (month: string, isChecked: boolean) =>
    setVisibleMonths(
      isChecked
        ? [...new Set([...visibleMonths, month])].sort()
        : visibleMonths.filter((item) => item !== month),
    );

  const run = async (task: () => Promise<ShareSettingsResponse>, successMessage: string) => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      settingsLoad.setData(await task());
      setDisplayName(null);
      setVisibleMonths(null);
      setMessage(successMessage);
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = () =>
    run(
      () => updateShareSettings({ displayName: displayName.trim(), visibleMonths }),
      settings?.enabled ? '공유 설정을 저장했어요.' : '공유 링크를 만들었어요. 아래 버튼으로 보내 주세요.',
    );

  /** Runs directly in the click handler so the browser keeps the user gesture for navigator.share. */
  const handleShareUrl = async (url: string) => {
    setMessage(SHARE_LINK_OUTCOME_MESSAGES[await shareOrCopyLink(url)]);
  };

  const handleCopyUrl = async (url: string) => {
    setMessage(
      SHARE_LINK_OUTCOME_MESSAGES[
        await shareOrCopyLink(url, { ...getBrowserShareEnvironment(), share: undefined })
      ],
    );
  };

  const handleConfirm = async () => {
    const action = confirmAction;

    setConfirmAction(ShareConfirmAction.NONE);

    if (action === ShareConfirmAction.ROTATE) {
      await run(rotateShareLink, '새 링크를 만들었어요. 이전 링크는 더 이상 열리지 않아요.');
    }

    if (action === ShareConfirmAction.STOP) {
      await run(stopSharing, '공유를 중지했어요. 이전 링크는 더 이상 열리지 않아요.');
    }
  };

  return {
    settingsLoad,
    settings,
    displayName,
    visibleMonths,
    isBusy,
    message,
    error,
    canShare,
    canSave: displayName.trim().length > 0 && visibleMonths.length > 0 && !isBusy,
    confirmAction,
    setDisplayName,
    setConfirmAction,
    handleToggleMonth,
    handleSave,
    handleShareUrl,
    handleCopyUrl,
    handleConfirm,
  };
};

'use client';

import { useEffect, useState } from 'react';

import {
  getErrorMessage,
  getShareSettings,
  isApiClientError,
  rotateShareLink,
  stopSharing,
  updateShareSettings,
} from '@/client/ApiClient';
import { shareOrCopyLink } from '@/client/ShareOrDownload';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { ShareConfirmAction } from '@/domain/enums/ShareConfirmAction';
import { ShareOutcome } from '@/domain/enums/ShareOutcome';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';

const OUTCOME_MESSAGES: Record<ShareOutcome, string | null> = {
  [ShareOutcome.SHARED]: '링크를 공유했어요.',
  [ShareOutcome.COPIED]: '링크를 복사했어요. 원하는 곳에 붙여 넣어 보내 주세요.',
  [ShareOutcome.DOWNLOADED]: null,
  [ShareOutcome.CANCELLED]: null,
  [ShareOutcome.FAILED]: '자동으로 복사하지 못했어요. 아래 링크를 길게 눌러 복사해 주세요.',
};

export const useShareSettingsState = (yearMonth: string, fallbackName: string) => {
  const [loadState, setLoadState] = useState(ScreenLoadState.LOADING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ShareSettingsResponse | null>(null);
  const [displayName, setDisplayName] = useState(fallbackName);
  const [visibleMonths, setVisibleMonths] = useState<string[]>([yearMonth]);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState(ShareConfirmAction.NONE);

  useEffect(() => {
    let isActive = true;

    getShareSettings()
      .then((response) => {
        if (!isActive) {
          return;
        }

        setSettings(response);
        setDisplayName(response.displayName || fallbackName);
        setVisibleMonths(response.enabled ? response.visibleMonths : [yearMonth]);
        setLoadState(ScreenLoadState.READY);
      })
      .catch((caught: unknown) => {
        if (!isActive) {
          return;
        }

        setLoadError(
          isApiClientError(caught) && caught.status === 404
            ? '링크 공유 기능을 아직 사용할 수 없어요. 잠시 후 다시 시도해 주세요.'
            : getErrorMessage(caught),
        );
        setLoadState(ScreenLoadState.ERROR);
      });

    return () => {
      isActive = false;
    };
  }, [fallbackName, yearMonth]);

  const handleToggleMonth = (month: string, isChecked: boolean) =>
    setVisibleMonths((current) =>
      isChecked ? [...new Set([...current, month])].sort() : current.filter((item) => item !== month),
    );

  const handleShareUrl = async (url: string) => {
    setMessage(OUTCOME_MESSAGES[await shareOrCopyLink(url)]);
  };

  const run = async (task: () => Promise<ShareSettingsResponse>): Promise<ShareSettingsResponse | null> => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await task();

      setSettings(response);

      return response;
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));

      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = async () => {
    const response = await run(() => updateShareSettings({ displayName: displayName.trim(), visibleMonths }));

    if (response?.url) {
      await handleShareUrl(response.url);
    }
  };

  const handleConfirm = async () => {
    const action = confirmAction;

    setConfirmAction(ShareConfirmAction.NONE);

    if (action === ShareConfirmAction.ROTATE) {
      const response = await run(rotateShareLink);

      if (response) {
        setMessage('새 링크를 만들었어요. 이전 링크는 더 이상 열리지 않아요.');
      }
    }

    if (action === ShareConfirmAction.STOP) {
      const response = await run(stopSharing);

      if (response) {
        setVisibleMonths([yearMonth]);
        setMessage('공유를 중지했어요. 이전 링크는 더 이상 열리지 않아요.');
      }
    }
  };

  const canSave = displayName.trim().length > 0 && visibleMonths.length > 0 && !isBusy;

  return {
    loadState,
    loadError,
    settings,
    displayName,
    visibleMonths,
    isBusy,
    message,
    error,
    canSave,
    confirmAction,
    setDisplayName,
    setConfirmAction,
    handleToggleMonth,
    handleSave,
    handleShareUrl,
    handleConfirm,
  };
};

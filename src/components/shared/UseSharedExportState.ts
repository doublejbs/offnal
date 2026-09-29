'use client';

import { useState } from 'react';

import { downloadSharedIcs, getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { buildSharedPngFilename, buildSharedPngInput } from '@/client/PngLayout';
import { renderMonthPng } from '@/client/PngRenderer';
import { downloadBlob, shareOrDownloadFile } from '@/client/ShareOrDownload';
import { ExportPanel } from '@/domain/enums/ExportPanel';
import { ShareOutcome } from '@/domain/enums/ShareOutcome';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';

const EXPIRED_MESSAGE =
  '링크가 만료되었거나 공유가 중지되었어요. 링크를 보낸 사람에게 새 링크를 요청해 주세요.';
const RATE_LIMITED_MESSAGE = '요청이 많아요. 잠시 후 다시 시도해 주세요.';

const PNG_OUTCOME_MESSAGES: Record<ShareOutcome, string | null> = {
  [ShareOutcome.SHARED]: '이미지를 공유했어요.',
  [ShareOutcome.DOWNLOADED]: '이미지를 저장했어요. 다운로드 폴더나 사진첩을 확인해 주세요.',
  [ShareOutcome.COPIED]: null,
  [ShareOutcome.CANCELLED]: null,
  [ShareOutcome.FAILED]: null,
};

const toIcsErrorMessage = (error: unknown): string => {
  if (isApiClientError(error) && error.status === 404) {
    return EXPIRED_MESSAGE;
  }

  if (isApiClientError(error) && error.status === 429) {
    return RATE_LIMITED_MESSAGE;
  }

  return `일정 파일을 받지 못했어요. ${getErrorMessage(error)}`;
};

/** Recipient-side exports of the viewed month: PNG drawn from the shared response, ICS from the server. */
export const useSharedExportState = (token: string, data: SharedCalendarResponse) => {
  const [openPanel, setOpenPanel] = useState<ExportPanel | null>(null);
  const [includeOff, setIncludeOff] = useState(false);
  const [busyPanel, setBusyPanel] = useState<ExportPanel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const yearMonth = data.month?.yearMonth ?? null;

  const resetFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const handleToggle = (panel: ExportPanel) => {
    resetFeedback();
    setOpenPanel((current) => (current === panel ? null : panel));
  };

  const handleSavePng = async () => {
    const input = buildSharedPngInput(data, new Date());

    if (!input) {
      return;
    }

    setBusyPanel(ExportPanel.PNG);
    resetFeedback();

    try {
      const blob = await renderMonthPng(input);

      setMessage(
        PNG_OUTCOME_MESSAGES[await shareOrDownloadFile(blob, buildSharedPngFilename(input.yearMonth))],
      );
    } catch {
      setError('이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusyPanel(null);
    }
  };

  const handleDownloadIcs = async () => {
    if (!yearMonth) {
      return;
    }

    setBusyPanel(ExportPanel.ICS);
    resetFeedback();

    try {
      const blob = await downloadSharedIcs(token, yearMonth, includeOff);

      downloadBlob(blob, `offnal-shared-${yearMonth}.ics`);
      setMessage('일정 파일을 받았어요. 파일을 열어 캘린더 앱으로 가져와 주세요.');
    } catch (caught: unknown) {
      setError(toIcsErrorMessage(caught));
    } finally {
      setBusyPanel(null);
    }
  };

  return {
    openPanel,
    includeOff,
    busyPanel,
    message,
    error,
    setIncludeOff,
    handleToggle,
    handleSavePng,
    handleDownloadIcs,
  };
};

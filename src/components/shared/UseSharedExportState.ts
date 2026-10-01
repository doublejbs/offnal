'use client';

import { useEffect, useRef, useState } from 'react';

import { downloadSharedIcs, getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { ICS_DOWNLOADED_MESSAGE, ICS_NAVIGATE_HINT } from '@/client/IcsCopy';
import { buildSharedIcsUrl } from '@/client/IcsUrls';
import { buildSharedPngInput } from '@/client/PngLayout';
import { renderMonthPng } from '@/client/PngRenderer';
import { PNG_OUTCOME_MESSAGES } from '@/client/ShareOutcomeMessages';
import { downloadBlob, shareOrDownloadFile } from '@/client/ShareOrDownload';
import { useIcsOpenSupport } from '@/components/share/UseIcsOpenSupport';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ExportPanel } from '@/domain/enums/ExportPanel';
import { IcsOpenMethod } from '@/domain/enums/IcsOpenMethod';
import { buildSharedIcsFileName, buildSharedPngFileName } from '@/domain/ExportFileNames';
import { SHARE_EXPIRED_MESSAGE } from '@/domain/ShareMessages';
import { type SharedMonth } from '@/domain/types/api/SharedCalendarResponse';

const EXPIRED_MESSAGE = `${SHARE_EXPIRED_MESSAGE} 링크를 보낸 사람에게 새 링크를 요청해 주세요.`;
const RATE_LIMITED_MESSAGE = '요청이 많아요. 잠시 후 다시 시도해 주세요.';

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

const toIcsErrorMessage = (error: unknown): string => {
  if (isApiClientError(error) && error.code === ApiErrorCode.NOT_FOUND) {
    return EXPIRED_MESSAGE;
  }

  if (isApiClientError(error) && error.code === ApiErrorCode.RATE_LIMITED) {
    return RATE_LIMITED_MESSAGE;
  }

  return `일정 파일을 받지 못했어요. ${getErrorMessage(error)}`;
};

/** Recipient-side exports of the viewed month: PNG drawn from the shared response, ICS from the server. */
export const useSharedExportState = (token: string, displayName: string, month: SharedMonth) => {
  const [openPanel, setOpenPanel] = useState<ExportPanel | null>(null);
  const [includeOff, setIncludeOff] = useState(false);
  const [busyPanel, setBusyPanel] = useState<ExportPanel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: a second tap before the busy state re-renders must not start another export.
  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const icsOpenSupport = useIcsOpenSupport();

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const startExport = (panel: ExportPanel): boolean => {
    if (inFlightRef.current) {
      return false;
    }

    inFlightRef.current = true;
    setBusyPanel(panel);
    setMessage(null);
    setError(null);

    return true;
  };

  const finishExport = () => {
    inFlightRef.current = false;

    if (isMountedRef.current) {
      setBusyPanel(null);
    }
  };

  const handleToggle = (panel: ExportPanel) => {
    setMessage(null);
    setError(null);
    icsOpenSupport.resetNotice();
    setOpenPanel((current) => (current === panel ? null : panel));
  };

  const handleSavePng = async () => {
    if (!startExport(ExportPanel.PNG)) {
      return;
    }

    try {
      const blob = await renderMonthPng(buildSharedPngInput(displayName, month, new Date()));

      if (!isMountedRef.current) {
        return;
      }

      const outcome = await shareOrDownloadFile(blob, buildSharedPngFileName(month.yearMonth));

      if (isMountedRef.current) {
        setMessage(PNG_OUTCOME_MESSAGES[outcome]);
      }
    } catch (caught: unknown) {
      if (isMountedRef.current) {
        setError(`이미지를 만들지 못했어요. ${getErrorMessage(caught)}`);
      }
    } finally {
      finishExport();
    }
  };

  const handleDownloadIcs = async () => {
    if (inFlightRef.current) {
      return;
    }

    icsOpenSupport.resetNotice();

    const method = icsOpenSupport.resolveMethod();

    if (method === IcsOpenMethod.IN_APP_NOTICE) {
      setMessage(null);
      setError(null);

      return;
    }

    if (!startExport(ExportPanel.ICS)) {
      return;
    }

    if (method === IcsOpenMethod.NAVIGATE) {
      setMessage(ICS_NAVIGATE_HINT);
      icsOpenSupport.navigateToIcs(buildSharedIcsUrl(token, month.yearMonth, includeOff, true), finishExport);

      return;
    }

    const controller = new AbortController();

    abortRef.current = controller;

    try {
      const blob = await downloadSharedIcs(token, month.yearMonth, includeOff, controller.signal);

      if (controller.signal.aborted || !isMountedRef.current) {
        return;
      }

      downloadBlob(blob, buildSharedIcsFileName(month.yearMonth));
      setMessage(ICS_DOWNLOADED_MESSAGE);
    } catch (caught: unknown) {
      if (!isAbortError(caught) && isMountedRef.current) {
        setError(toIcsErrorMessage(caught));
      }
    } finally {
      abortRef.current = null;
      finishExport();
    }
  };

  return {
    openPanel,
    includeOff,
    busyPanel,
    message,
    error,
    icsOpenSupport,
    setIncludeOff,
    handleToggle,
    handleSavePng,
    handleDownloadIcs,
  };
};

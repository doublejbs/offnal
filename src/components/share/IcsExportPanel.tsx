'use client';

import { useRef, useState } from 'react';

import { downloadIcs, getErrorMessage } from '@/client/ApiClient';
import { ICS_DOWNLOADED_MESSAGE, ICS_NAVIGATE_HINT } from '@/client/IcsCopy';
import { buildIcsUrl } from '@/client/IcsUrls';
import { downloadBlob } from '@/client/ShareOrDownload';
import IcsExportFormView from '@/components/share/IcsExportFormView';
import { useIcsOpenSupport } from '@/components/share/UseIcsOpenSupport';
import { buildIcsFileName } from '@/domain/ExportFileNames';
import { IcsOpenMethod } from '@/domain/enums/IcsOpenMethod';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { filterUsedDefinitions } from '@/domain/UsedDefinitions';

type IcsExportPanelProps = {
  yearMonth: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
};

/**
 * One-time ICS import (never described as sync). Off days are excluded unless the user opts in.
 * iOS opens the calendar import sheet by navigating; in-app browsers get a notice (Spec §19).
 */
const IcsExportPanel = ({ yearMonth, definitions, entries }: IcsExportPanelProps) => {
  const [includeOff, setIncludeOff] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: a second tap before the busy state re-renders must not start another download.
  const inFlightRef = useRef(false);
  const openSupport = useIcsOpenSupport();

  const finish = () => {
    inFlightRef.current = false;
    setIsBusy(false);
  };

  const handleDownload = async () => {
    if (inFlightRef.current) {
      return;
    }

    setError(null);
    setMessage(null);
    openSupport.resetNotice();

    const method = openSupport.resolveMethod();

    if (method === IcsOpenMethod.IN_APP_NOTICE) {
      return;
    }

    inFlightRef.current = true;
    setIsBusy(true);

    if (method === IcsOpenMethod.NAVIGATE) {
      setMessage(ICS_NAVIGATE_HINT);
      openSupport.navigateToIcs(buildIcsUrl(yearMonth, includeOff, true), finish);

      return;
    }

    try {
      const blob = await downloadIcs(yearMonth, includeOff);

      downloadBlob(blob, buildIcsFileName(yearMonth));
      setMessage(ICS_DOWNLOADED_MESSAGE);
    } catch (caught: unknown) {
      setError(`일정 파일을 받지 못했어요. ${getErrorMessage(caught)}`);
    } finally {
      finish();
    }
  };

  return (
    <IcsExportFormView
      usedDefinitions={filterUsedDefinitions(definitions, entries)}
      includeOff={includeOff}
      onChangeIncludeOff={setIncludeOff}
      isBusy={isBusy}
      error={error}
      message={message}
      onDownload={handleDownload}
      openSupport={openSupport}
    />
  );
};

export default IcsExportPanel;

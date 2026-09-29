'use client';

import { useRef, useState } from 'react';

import { downloadIcs, getErrorMessage } from '@/client/ApiClient';
import { downloadBlob } from '@/client/ShareOrDownload';
import IcsExportFormView from '@/components/share/IcsExportFormView';
import { buildIcsFileName } from '@/domain/ExportFileNames';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { filterUsedDefinitions } from '@/domain/UsedDefinitions';

type IcsExportPanelProps = {
  yearMonth: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
};

/** One-time ICS import (never described as sync). Off days are excluded unless the user opts in. */
const IcsExportPanel = ({ yearMonth, definitions, entries }: IcsExportPanelProps) => {
  const [includeOff, setIncludeOff] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: a second tap before the busy state re-renders must not start another download.
  const inFlightRef = useRef(false);

  const handleDownload = async () => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const blob = await downloadIcs(yearMonth, includeOff);

      downloadBlob(blob, buildIcsFileName(yearMonth));
      setMessage('일정 파일을 받았어요. 파일을 열어 캘린더 앱으로 가져와 주세요.');
    } catch (caught: unknown) {
      setError(`일정 파일을 받지 못했어요. ${getErrorMessage(caught)}`);
    } finally {
      inFlightRef.current = false;
      setIsBusy(false);
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
    />
  );
};

export default IcsExportPanel;

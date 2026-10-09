'use client';

import { useRef, useState } from 'react';

import { getErrorMessage, getExportData } from '@/client/ApiClient';
import { formatDefinitionSummary } from '@/client/DisplayText';
import { renderMonthPng } from '@/client/PngRenderer';
import { PNG_OUTCOME_MESSAGES } from '@/client/ShareOutcomeMessages';
import { shareOrDownloadFile } from '@/client/ShareOrDownload';
import MonthGrid from '@/components/calendar/MonthGrid';
import ExportFeedbackView from '@/components/share/ExportFeedbackView';
import { buildPngFileName } from '@/domain/ExportFileNames';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { filterUsedDefinitions } from '@/domain/UsedDefinitions';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type PngExportPanelProps = {
  yearMonth: string;
  displayName: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
};

/** Preview, then a real PNG drawn from the entitlement-checked export data (never from this preview). */
const PngExportPanel = ({ yearMonth, displayName, definitions, entries }: PngExportPanelProps) => {
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: a second tap before the busy state re-renders must not start another export.
  const inFlightRef = useRef(false);
  const used = filterUsedDefinitions(definitions, entries);

  const handleSave = async () => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const data = await getExportData(yearMonth);
      const blob = await renderMonthPng(data);

      setMessage(PNG_OUTCOME_MESSAGES[await shareOrDownloadFile(blob, buildPngFileName(yearMonth))]);
    } catch (caught: unknown) {
      setError(`이미지를 만들지 못했어요. ${getErrorMessage(caught)}`);
    } finally {
      inFlightRef.current = false;
      setIsBusy(false);
    }
  };

  return (
    <div>
      <p className="mt-0">
        {displayName}의 {formatYearMonthLabel(yearMonth)} · 이미지 미리보기
      </p>
      <MonthGrid
        yearMonth={yearMonth}
        entries={entries}
        definitions={definitions}
        selectedDate={null}
        showLegend={false}
        showToday={false}
      />
      <div className="hint">
        {used.map((definition) => (
          <span key={definition.code} className="block-text">
            {formatDefinitionSummary(definition)}
          </span>
        ))}
      </div>
      <ExportFeedbackView error={error} message={message}>
        <button type="button" className="primary" onClick={handleSave} disabled={isBusy}>
          {isBusy ? '이미지를 만드는 중…' : '이미지 저장'}
        </button>
      </ExportFeedbackView>
      <div className="hint">저장된 이미지는 이후 근무 변경이 반영되지 않아요.</div>
    </div>
  );
};

export default PngExportPanel;

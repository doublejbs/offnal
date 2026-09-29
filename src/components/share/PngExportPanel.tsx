'use client';

import { useState } from 'react';

import { getErrorMessage, getExportData } from '@/client/ApiClient';
import { formatDefinitionSummary } from '@/client/DisplayText';
import { buildPngFilename, renderMonthPng } from '@/client/PngRenderer';
import { shareOrDownloadFile } from '@/client/ShareOrDownload';
import MonthGrid from '@/components/calendar/MonthGrid';
import { ShareOutcome } from '@/domain/enums/ShareOutcome';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type PngExportPanelProps = {
  yearMonth: string;
  displayName: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
};

const OUTCOME_MESSAGES: Record<ShareOutcome, string | null> = {
  [ShareOutcome.SHARED]: '이미지를 공유했어요.',
  [ShareOutcome.DOWNLOADED]: '이미지를 저장했어요. 다운로드 폴더나 사진첩을 확인해 주세요.',
  [ShareOutcome.COPIED]: null,
  [ShareOutcome.CANCELLED]: null,
  [ShareOutcome.FAILED]: null,
};

/** Preview, then a real PNG drawn from the entitlement-checked export data (never from this preview). */
const PngExportPanel = ({ yearMonth, displayName, definitions, entries }: PngExportPanelProps) => {
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usedCodes = new Set(entries.map((entry) => entry.code));
  const used = definitions.filter((definition) => usedCodes.has(definition.code));

  const handleSave = async () => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const data = await getExportData(yearMonth);
      const blob = await renderMonthPng(data);

      setMessage(OUTCOME_MESSAGES[await shareOrDownloadFile(blob, buildPngFilename(yearMonth))]);
    } catch (caught: unknown) {
      setError(`이미지를 만들지 못했어요. ${getErrorMessage(caught)}`);
    } finally {
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
      />
      <div className="hint">
        {used.map((definition) => (
          <span key={definition.code} className="block-text">
            {formatDefinitionSummary(definition)}
          </span>
        ))}
      </div>
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="primary" onClick={handleSave} disabled={isBusy}>
        {isBusy ? '이미지를 만드는 중…' : '이미지 저장'}
      </button>
      <div className="status-line mt-8" role="status" aria-live="polite">
        {message}
      </div>
      <div className="hint">저장된 이미지는 이후 근무 변경이 반영되지 않아요.</div>
    </div>
  );
};

export default PngExportPanel;

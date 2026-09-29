'use client';

import { useState } from 'react';

import { downloadIcs, getErrorMessage } from '@/client/ApiClient';
import { formatDefinitionSummary } from '@/client/DisplayText';
import { downloadBlob } from '@/client/ShareOrDownload';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

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
  const usedCodes = new Set(entries.map((entry) => entry.code));
  const used = definitions.filter((definition) => usedCodes.has(definition.code));

  const handleDownload = async () => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const blob = await downloadIcs(yearMonth, includeOff);

      downloadBlob(blob, `offnal-${yearMonth}.ics`);
      setMessage('일정 파일을 받았어요. 파일을 열어 캘린더 앱으로 가져와 주세요.');
    } catch (caught: unknown) {
      setError(`일정 파일을 받지 못했어요. ${getErrorMessage(caught)}`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div>
      <div className="block mt-0">
        <h2>출퇴근 시간을 함께</h2>
        <p>
          {used.map((definition) => (
            <span key={definition.code} className="block-text">
              {formatDefinitionSummary(definition)}
            </span>
          ))}
        </p>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={includeOff}
          onChange={(event) => setIncludeOff(event.target.checked)}
        />
        휴무도 종일 일정으로 추가
      </label>
      <div className="notice">
        한 번 가져오는 방식이에요. 이후 근무 변경은 자동 반영되지 않아요. 다시 가져오면 일정이 중복될 수
        있어요.
      </div>
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="primary" onClick={handleDownload} disabled={isBusy}>
        {isBusy ? '파일을 만드는 중…' : '일정 파일 받기'}
      </button>
      <div className="status-line mt-8" role="status" aria-live="polite">
        {message}
      </div>
      <div className="hint">ICS 형식 · 한국 시간 기준</div>
    </div>
  );
};

export default IcsExportPanel;

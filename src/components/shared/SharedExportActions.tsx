'use client';

import { CalendarPlus, Image as ImageIcon } from 'lucide-react';

import { formatDefinitionSummary } from '@/client/DisplayText';
import ExportRow from '@/components/share/ExportRow';
import { useSharedExportState } from '@/components/shared/UseSharedExportState';
import { ExportPanel } from '@/domain/enums/ExportPanel';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type SharedExportActionsProps = {
  token: string;
  data: SharedCalendarResponse;
};

type FeedbackProps = {
  error: string | null;
  message: string | null;
};

const FeedbackView = ({ error, message }: FeedbackProps) => (
  <>
    {error && (
      <div className="warning" role="alert">
        {error}
      </div>
    )}
    <div className="status-line mt-8" role="status" aria-live="polite">
      {message}
    </div>
  </>
);

/** Recipient's exports of the viewed month (no login): month image and one-time calendar import. */
const SharedExportActions = ({ token, data }: SharedExportActionsProps) => {
  const state = useSharedExportState(token, data);
  const month = data.month;

  if (!month) {
    return null;
  }

  const monthLabel = formatYearMonthLabel(month.yearMonth);
  const usedCodes = new Set(month.entries.map((entry) => entry.code));
  const used = month.definitions.filter((definition) => usedCodes.has(definition.code));
  const isPngBusy = state.busyPanel === ExportPanel.PNG;
  const isIcsBusy = state.busyPanel === ExportPanel.ICS;

  return (
    <section className="mt-16" aria-label={`${monthLabel} 근무 내보내기`}>
      <ExportRow
        panel={ExportPanel.PNG}
        openPanel={state.openPanel}
        icon={<ImageIcon size={20} aria-hidden="true" />}
        title="달력 이미지 저장"
        description={`${monthLabel} 달력을 사진첩에 보관`}
        onToggle={state.handleToggle}
      >
        <p className="mt-0">
          {data.displayName}님의 {monthLabel} 근무를 이미지로 저장해요.
        </p>
        <FeedbackView error={state.error} message={state.message} />
        <button
          type="button"
          className="primary"
          onClick={state.handleSavePng}
          disabled={state.busyPanel !== null}
        >
          {isPngBusy ? '이미지를 만드는 중…' : '이미지 저장'}
        </button>
        <div className="hint">저장된 이미지는 이후 근무 변경이 반영되지 않아요.</div>
      </ExportRow>
      <ExportRow
        panel={ExportPanel.ICS}
        openPanel={state.openPanel}
        icon={<CalendarPlus size={20} aria-hidden="true" />}
        title="내 캘린더에 추가"
        description={`${monthLabel} 출퇴근 시간을 내 캘린더에서 확인`}
        onToggle={state.handleToggle}
      >
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
            checked={state.includeOff}
            onChange={(event) => state.setIncludeOff(event.target.checked)}
          />
          휴무도 종일 일정으로 추가
        </label>
        <div className="notice">
          한 번 가져오는 방식이에요. 이후 근무 변경은 자동 반영되지 않아요. 다시 가져오면 일정이 중복될 수
          있어요.
        </div>
        <FeedbackView error={state.error} message={state.message} />
        <button
          type="button"
          className="primary"
          onClick={state.handleDownloadIcs}
          disabled={state.busyPanel !== null}
        >
          {isIcsBusy ? '파일을 만드는 중…' : '일정 파일 받기'}
        </button>
        <div className="hint">ICS 형식 · 한국 시간 기준</div>
      </ExportRow>
    </section>
  );
};

export default SharedExportActions;

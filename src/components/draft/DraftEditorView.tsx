'use client';

import { Image as ImageIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { getRecognitionSourceUrl } from '@/client/ApiClient';
import { formatReviewWarning, formatUndefinedCodesWarning } from '@/client/DisplayText';
import { type LocalDraft } from '@/client/DraftSaveQueue';
import BackLink from '@/components/BackLink';
import MonthGrid from '@/components/calendar/MonthGrid';
import DraftHeaderFields from '@/components/draft/DraftHeaderFields';
import PublishPanel from '@/components/draft/PublishPanel';
import SaveStatus from '@/components/draft/SaveStatus';
import ShiftEditor from '@/components/draft/ShiftEditor';
import ShiftTimeEditor from '@/components/draft/ShiftTimeEditor';
import SourceStrip from '@/components/draft/SourceStrip';
import { type DraftReviewState } from '@/components/draft/UseDraftReviewState';
import SourcePreview from '@/components/SourcePreview';
import { DraftFocusTarget } from '@/domain/enums/DraftFocusTarget';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type DraftEditorViewProps = {
  state: DraftReviewState;
  server: DraftResponse;
  local: LocalDraft;
};

const findTimeRow = (container: HTMLElement | null, code: string): HTMLElement | null =>
  container?.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"]`) ?? null;

/**
 * Focus after React has rendered the newly selected date / opened section. Focus does not scroll by itself
 * (it would jump before the smooth scroll); the scroll is instant when the user prefers reduced motion.
 */
const focusLater = (element: () => HTMLElement | null) => {
  window.requestAnimationFrame(() => {
    const target = element();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  });
};

const DraftEditorView = ({ state, server, local }: DraftEditorViewProps) => {
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const editorRef = useRef<HTMLElement | null>(null);
  const timeSummaryRef = useRef<HTMLElement | null>(null);
  const timeConfirmRef = useRef<HTMLInputElement | null>(null);
  const timeRowsRef = useRef<HTMLDivElement | null>(null);
  const selectedEntry = local.entries.find((entry) => entry.date === state.selectedDate) ?? null;
  const warning = formatReviewWarning(state.review);
  const undefinedWarning = formatUndefinedCodesWarning(state.undefinedCodes);
  const sourceByDate = new Map(server.sourceCells.map((cell) => [cell.date, cell.rawText]));
  const canShowSource = server.sourceAvailable && server.jobId !== null;

  const handleSelectBlocker = (blocker: PublishBlocker) => {
    const target = state.handleSelectBlocker(blocker);

    focusLater(() => (target === DraftFocusTarget.TIME_EDITOR ? timeSummaryRef.current : editorRef.current));
  };

  const handleSelectUndefinedCodes = () => {
    const code = state.handleSelectUndefinedCodes();

    focusLater(() => (code ? findTimeRow(timeRowsRef.current, code) : null) ?? timeSummaryRef.current);
  };

  const handleSelectTimeConfirmation = () => {
    state.setIsTimeEditorOpen(true);
    focusLater(() => timeConfirmRef.current);
  };

  return (
    <>
      {server.jobId && <BackLink href={`/recognitions/${server.jobId}/select`} label="이름 다시 고르기" />}
      <div className="label">2 / 2 · 인식 결과 확인</div>
      <h1>
        내 근무가 맞는지
        <br />
        확인해 주세요.
      </h1>
      <div className="tiny">
        {local.displayName || '이름 없음'} · {formatYearMonthLabel(local.yearMonth)} · 날짜를 눌러 수정
      </div>
      <DraftHeaderFields
        displayName={local.displayName}
        monthInput={state.monthInput}
        monthError={state.monthError}
        disabled={state.isLocked}
        onNameChange={state.handleNameChange}
        onMonthChange={state.handleMonthChange}
      />
      <SaveStatus
        saveState={state.saveState}
        saveMessage={state.isMonthChanging ? '대상 월을 바꾸는 중이에요…' : state.saveMessage}
        onRetry={() => void state.handleRetrySave()}
        onReload={state.handleReload}
      />
      {warning || undefinedWarning ? (
        <div className="warning">
          {warning}
          {undefinedWarning && (
            <div>
              <button type="button" className="linkish" onClick={handleSelectUndefinedCodes}>
                {undefinedWarning}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="notice">모든 날짜를 확인했어요. 근무 시간도 확인해 주세요.</div>
      )}
      <SourceStrip
        sourceCells={server.sourceCells}
        reviewDates={state.review.dates}
        selectedDate={state.selectedDate}
      />
      {canShowSource && (
        <button
          type="button"
          className="textbutton"
          aria-expanded={isSourceOpen}
          onClick={() => setIsSourceOpen((value) => !value)}
        >
          <ImageIcon size={16} aria-hidden="true" />
          {isSourceOpen ? '원본 사진 닫기' : '원본 사진 크게 보기'}
        </button>
      )}
      {canShowSource && isSourceOpen && server.jobId && (
        <SourcePreview src={getRecognitionSourceUrl(server.jobId)} />
      )}
      <div className="mt-14">
        <MonthGrid
          yearMonth={local.yearMonth}
          entries={local.entries}
          definitions={local.definitions}
          selectedDate={state.selectedDate}
          onSelectDate={state.setSelectedDate}
        />
      </div>
      {selectedEntry && (
        <ShiftEditor
          entry={selectedEntry}
          rawText={
            server.sourceCells.length > 0
              ? sourceByDate.has(selectedEntry.date)
                ? sourceByDate.get(selectedEntry.date)
                : undefined
              : undefined
          }
          definitions={local.definitions}
          disabled={state.isLocked}
          hasSourceCells={server.sourceCells.length > 0}
          sectionRef={editorRef}
          onSelectCode={state.handleSelectCode}
          onAddCode={(code, label) => state.handleAddCode(code, label, true)}
        />
      )}
      <ShiftTimeEditor
        definitions={local.definitions}
        entries={local.entries}
        undefinedCodes={state.undefinedCodes}
        isOpen={state.isTimeEditorOpen}
        disabled={state.isLocked}
        requiresConfirmation={server.jobId !== null}
        isConfirmed={state.isTimeConfirmed}
        summaryRef={timeSummaryRef}
        confirmRef={timeConfirmRef}
        rowsRef={timeRowsRef}
        onToggle={state.setIsTimeEditorOpen}
        onConfirmChange={state.setIsTimeConfirmed}
        onUpdate={state.handleUpdateDefinition}
        onRemove={state.handleRemoveDefinition}
        onAdd={(code, label) => state.handleAddCode(code, label, false)}
      />
      <PublishPanel
        access={server.access}
        blockers={state.blockers}
        needsTimeConfirmation={state.needsTimeConfirmation}
        canPublish={state.canPublish}
        publish={state.publish}
        onSelectBlocker={handleSelectBlocker}
        onSelectTimeConfirmation={handleSelectTimeConfirmation}
      />
    </>
  );
};

export default DraftEditorView;

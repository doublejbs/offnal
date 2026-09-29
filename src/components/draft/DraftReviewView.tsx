'use client';

import { Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { formatReviewWarning } from '@/client/DisplayText';
import AuthRequired from '@/components/AuthRequired';
import BackLink from '@/components/BackLink';
import MonthGrid from '@/components/calendar/MonthGrid';
import DraftHeaderFields from '@/components/draft/DraftHeaderFields';
import PublishPanel from '@/components/draft/PublishPanel';
import SaveStatus from '@/components/draft/SaveStatus';
import ShiftEditor from '@/components/draft/ShiftEditor';
import ShiftTimeEditor from '@/components/draft/ShiftTimeEditor';
import SourceStrip from '@/components/draft/SourceStrip';
import { useDraftReviewState } from '@/components/draft/UseDraftReviewState';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import SourcePreview from '@/components/SourcePreview';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type DraftReviewViewProps = {
  draftId: string;
};

const DraftReviewView = ({ draftId }: DraftReviewViewProps) => {
  const state = useDraftReviewState(draftId);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const { server, local } = state;

  if (state.loadState === ScreenLoadState.LOADING) {
    return <LoadingState text="내 근무를 불러오는 중이에요…" />;
  }

  if (state.loadState === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`/drafts/${draftId}`} />;
  }

  if (state.loadState !== ScreenLoadState.READY || !server || !local) {
    return (
      <RecoverableError
        title={
          state.loadState === ScreenLoadState.EXPIRED
            ? '초안 보관 기간이 지났어요'
            : '초안을 불러오지 못했어요'
        }
        message={state.loadError ?? '다시 시도해 주세요.'}
        onRetry={state.loadState === ScreenLoadState.ERROR ? state.handleReload : undefined}
        alternativeHref="/"
        alternativeLabel="근무표 새로 올리기"
      />
    );
  }

  if (!state.isEditable) {
    return (
      <EmptyState
        label="이미 저장했어요"
        title="이 근무표는 더 이상 수정할 수 없어요"
        description="이미 저장했거나 취소한 초안이에요. 내 달력에서 확인하고, 필요하면 근무 수정을 눌러 주세요."
      >
        <Link href={`/calendar/${server.draft.yearMonth}`} className="primary">
          내 달력 보기
        </Link>
      </EmptyState>
    );
  }

  const selectedEntry = local.entries.find((entry) => entry.date === state.selectedDate) ?? null;
  const warning = formatReviewWarning(state.review);
  const sourceByDate = new Map(server.sourceCells.map((cell) => [cell.date, cell.rawText]));
  const canShowSource = server.sourceAvailable && server.jobId !== null;
  const isLocked = state.isConflict;

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
        disabled={isLocked}
        onNameChange={state.handleNameChange}
        onMonthChange={state.handleMonthChange}
      />
      <SaveStatus
        saveState={state.saveState}
        saveMessage={state.saveMessage}
        onRetry={() => void state.handleRetrySave()}
        onReload={() => void state.handleReload()}
      />
      {warning ? (
        <div className="warning">{warning}</div>
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
      {canShowSource && isSourceOpen && server.jobId && <SourcePreview recognitionId={server.jobId} />}
      <div style={{ marginTop: 14 }}>
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
          rawText={server.sourceCells.length > 0 ? (sourceByDate.get(selectedEntry.date) ?? null) : undefined}
          definitions={local.definitions}
          disabled={isLocked}
          onSelectCode={state.handleSelectCode}
          onAddCode={(code, label) => state.handleAddCode(code, label, true)}
        />
      )}
      <ShiftTimeEditor
        definitions={local.definitions}
        entries={local.entries}
        isOpen={state.isTimeEditorOpen}
        disabled={isLocked}
        onToggle={state.setIsTimeEditorOpen}
        onUpdate={state.handleUpdateDefinition}
        onRemove={state.handleRemoveDefinition}
        onAdd={(code, label) => state.handleAddCode(code, label, false)}
      />
      <PublishPanel
        access={server.access}
        blockers={state.blockers}
        publish={state.publish}
        isBlockedBySave={isLocked}
        onSelectBlocker={state.handleSelectBlocker}
      />
    </>
  );
};

export default DraftReviewView;

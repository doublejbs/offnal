'use client';

import { useState } from 'react';

import { formatUndefinedCodesWarning } from '@/client/DisplayText';
import { listFailedRows } from '@/client/TeamRosterGrid';
import SaveStatus from '@/components/draft/SaveStatus';
import ShiftTimeEditor from '@/components/draft/ShiftTimeEditor';
import RosterAddRowForm from '@/components/roster/RosterAddRowForm';
import RosterCellEditorView from '@/components/roster/RosterCellEditorView';
import RosterFailedRowsView from '@/components/roster/RosterFailedRowsView';
import RosterGridView from '@/components/roster/RosterGridView';
import RosterPersonEditorView from '@/components/roster/RosterPersonEditorView';
import RosterPersonListView from '@/components/roster/RosterPersonListView';
import RosterPublishView from '@/components/roster/RosterPublishView';
import RosterReviewHeader from '@/components/roster/RosterReviewHeader';
import RosterUnmatchedView from '@/components/roster/RosterUnmatchedView';
import { type RosterEditorState } from '@/components/roster/UseRosterEditorState';
import { useRosterReviewState } from '@/components/roster/UseRosterReviewState';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { listDates } from '@/domain/YearMonth';

const UNSAVED_RETRY_MESSAGE = '저장하지 못한 수정이 있어요. 저장 상태를 확인한 뒤 다시 시도해 주세요.';

type RosterReviewViewProps = {
  teamId: string;
  state: RosterEditorState;
  view: TeamRosterResponse;
};

/** Phase (b) + (c): whole-team review (table ≥768px, person list below), shared legend, unmatched people, publish. */
const RosterReviewView = ({ teamId, state, view }: RosterReviewViewProps) => {
  const review = useRosterReviewState(view);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { edits, autosave } = state;
  const yearMonth = view.roster.yearMonth ?? '';
  const dates = yearMonth ? listDates(yearMonth) : [];
  const included = view.rows.filter((row) => !row.excluded);
  const reviewCellCount = included.reduce((sum, row) => sum + row.reviewCount, 0);
  const selectedRow = review.selected
    ? view.rows.find((row) => row.id === review.selected?.rowId)
    : undefined;
  const openRow = review.openRowId ? view.rows.find((row) => row.id === review.openRowId) : undefined;
  const undefinedWarning = formatUndefinedCodesWarning(review.undefinedCodes);
  const failedRows = listFailedRows(view.rows);

  /** Unsaved edits would be dropped by the reload after re-reading, so they must be saved first. */
  const handleRetryFailed = async () => {
    setRetryError(null);

    if (!(await autosave.flush())) {
      setRetryError(UNSAVED_RETRY_MESSAGE);

      return;
    }

    await state.extraction.start(true);
  };

  if (!review.isWide && openRow) {
    return (
      <>
        <SaveStatus
          saveState={autosave.saveState}
          saveMessage={autosave.saveMessage}
          onRetry={() => void autosave.flush()}
          onReload={state.handleReload}
        />
        <RosterPersonEditorView
          row={openRow}
          yearMonth={yearMonth}
          definitions={view.definitions}
          selected={review.selected}
          edits={edits}
          onSelect={review.handleSelectCell}
          onBack={review.handleCloseRow}
        />
      </>
    );
  }

  return (
    <div className="roster-wide">
      <RosterReviewHeader
        teamId={teamId}
        view={view}
        includedCount={included.length}
        reviewCellCount={reviewCellCount}
        autosave={autosave}
        edits={edits}
        onReload={state.handleReload}
      />
      <RosterFailedRowsView
        failedRows={failedRows}
        isBusy={state.extraction.isRunning}
        disabled={state.isLocked || autosave.isDirty()}
        onRetry={() => void handleRetryFailed()}
      />
      {retryError && (
        <div className="warning" role="alert">
          {retryError}
        </div>
      )}
      <RosterUnmatchedView
        unmatched={review.unmatched}
        rows={view.rows}
        disabled={!edits.canEdit}
        onMatch={edits.handleMatchRow}
        onDismiss={review.handleDismissUnmatched}
      />
      {undefinedWarning && (
        <div className="warning">
          <button type="button" className="linkish" onClick={review.handleSelectUndefinedCodes}>
            {undefinedWarning}
          </button>
        </div>
      )}
      <ShiftTimeEditor
        definitions={view.definitions}
        entries={review.allEntries}
        undefinedCodes={review.undefinedCodes}
        isOpen={review.isLegendOpen}
        disabled={!edits.canEdit}
        requiresConfirmation={review.requiresTimeConfirmation}
        isConfirmed={review.isTimeConfirmed}
        summaryRef={review.legendRef}
        confirmRef={review.confirmRef}
        rowsRef={review.legendRowsRef}
        onToggle={review.setIsLegendOpen}
        onConfirmChange={review.setTimeConfirmed}
        onUpdate={edits.handleUpdateDefinition}
        onRemove={edits.handleRemoveDefinition}
        onAdd={(code, label) => edits.handleAddCode(code, label, null)}
      />
      {review.isWide ? (
        <>
          <div className="tiny mb-8">칸을 누르거나 방향키로 옮겨 고쳐요. 표는 옆으로 밀어 볼 수 있어요.</div>
          <RosterGridView
            rows={view.rows}
            dates={dates}
            definitions={view.definitions}
            selected={review.selected}
            onSelect={review.handleSelectCell}
          />
          {selectedRow && review.selected && (
            <RosterCellEditorView
              row={selectedRow}
              date={review.selected.date}
              definitions={view.definitions}
              edits={edits}
              isDocked
            />
          )}
        </>
      ) : (
        <RosterPersonListView rows={view.rows} onOpen={review.handleOpenRow} />
      )}
      <RosterAddRowForm disabled={!edits.canEdit} onAdd={edits.handleAddRow} />
      <RosterPublishView
        blockers={review.blockers}
        rows={view.rows}
        changesPreview={view.changesPreview}
        includedCount={included.length}
        needsTimeConfirmation={review.requiresTimeConfirmation && !review.isTimeConfirmed}
        isSaving={
          autosave.saveState === DraftSaveState.PENDING || autosave.saveState === DraftSaveState.SAVING
        }
        publish={state.publish}
        onSelectBlocker={review.handleSelectBlocker}
        onSelectTimeConfirmation={review.handleSelectTimeConfirmation}
      />
    </div>
  );
};

export default RosterReviewView;

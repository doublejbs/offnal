'use client';

import { useId } from 'react';

import { describeBlocker } from '@/client/DisplayText';
import { formatChangesHeadline, formatPersonChanges, formatRowName } from '@/client/TeamDisplayText';
import { formatUnlinkedWarning } from '@/client/TeamRosterErrors';
import ConfirmDialog from '@/components/ConfirmDialog';
import { type RosterPublishState } from '@/components/roster/UseRosterPublish';
import { type TeamRosterChangePreview } from '@/domain/types/api/TeamRosterChangePreview';
import { type TeamRosterRowBlocker } from '@/domain/types/api/TeamRosterRowBlocker';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';

type RosterPublishViewProps = {
  blockers: TeamRosterRowBlocker[];
  /** For same-name labels ("김하루 (2)") of blockers and changes. */
  rows: TeamRosterRowDto[];
  changesPreview: TeamRosterChangePreview | null;
  includedCount: number;
  needsTimeConfirmation: boolean;
  isSaving: boolean;
  publish: RosterPublishState;
  onSelectBlocker: (rowId: string, blocker: PublishBlocker) => void;
  onSelectTimeConfirmation: () => void;
};

/** Phase (c): changes preview, blockers (tap → focus the cell / legend), publish and the unlinked-rows confirm. */
const RosterPublishView = ({
  blockers,
  rows,
  changesPreview,
  includedCount,
  needsTimeConfirmation,
  isSaving,
  publish,
  onSelectBlocker,
  onSelectTimeConfirmation,
}: RosterPublishViewProps) => {
  const titleId = useId();
  const nameOf = (match: (row: TeamRosterRowDto) => boolean, fallback: string): string => {
    const row = rows.find(match);

    return row ? formatRowName(row) : fallback;
  };
  // Local blockers follow unsaved edits; the server's 422 list is only shown when the local mirror found none.
  const shownBlockers = blockers.length > 0 ? blockers : (publish.serverBlockers ?? []);
  const canPublish =
    blockers.length === 0 && !needsTimeConfirmation && includedCount > 0 && !publish.isPublishing;

  return (
    <section aria-labelledby={titleId} className="publish-panel">
      <h2 id={titleId}>배포</h2>
      {changesPreview ? (
        <details className="notice">
          <summary className="summary">
            {formatChangesHeadline(changesPreview)} · 저장된 내용 기준 (사람별 보기)
          </summary>
          <ul className="change-list">
            {changesPreview.rows.map((row) => (
              <li key={row.rowKey}>
                {formatPersonChanges(
                  nameOf((item) => item.rowKey === row.rowKey, row.displayName),
                  row.changes,
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <div className="tiny mb-8">이 달의 첫 배포예요. 배포하면 승인된 팀원 달력에 바로 나타나요.</div>
      )}
      {(shownBlockers.length > 0 || needsTimeConfirmation) && (
        <div className="warning">
          <strong>배포하려면 아래를 먼저 확인해 주세요</strong>
          <ul>
            {shownBlockers.flatMap((row) =>
              row.blockers.map((blocker) => (
                <li key={`${row.rowId}-${blocker.reason}`}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => onSelectBlocker(row.rowId, blocker)}
                  >
                    {nameOf((item) => item.id === row.rowId, row.displayName)}: {describeBlocker(blocker)}
                  </button>
                </li>
              )),
            )}
            {needsTimeConfirmation && (
              <li>
                <button type="button" className="linkish" onClick={onSelectTimeConfirmation}>
                  근무 시간을 확인하고 체크해 주세요
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {includedCount === 0 && (
        <div className="warning">배포할 사람이 없어요. 제외하지 않은 행이 하나 이상 있어야 해요.</div>
      )}
      {publish.error && (
        <div className="warning" role="alert">
          {publish.error}
        </div>
      )}
      <button
        type="button"
        className="primary"
        disabled={!canPublish}
        onClick={() => void publish.handlePublish()}
      >
        {publish.isPublishing ? '배포하는 중…' : isSaving ? '저장 후 배포' : '팀에 배포하기'}
      </button>
      <div className="hint">
        배포하면 원본 사진은 삭제돼요. 배포 후에도 “수정하기”로 고쳐 다시 배포할 수 있어요.
      </div>
      <ConfirmDialog
        isOpen={publish.unlinkedRows !== null}
        title="연결된 팀원의 행이 없어요"
        message={formatUnlinkedWarning(publish.unlinkedRows ?? [])}
        confirmLabel="그래도 배포"
        isDanger
        isBusy={publish.isPublishing}
        onConfirm={() => void publish.handlePublish(true)}
        onCancel={publish.handleCancelUnlinked}
      />
    </section>
  );
};

export default RosterPublishView;

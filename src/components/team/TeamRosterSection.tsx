'use client';

import Link from 'next/link';
import { useId } from 'react';

import { formatDateTime } from '@/client/DisplayText';
import { formatRevision, formatRosterProgress } from '@/client/TeamDisplayText';
import { formatUnlinkedWarning } from '@/client/TeamRosterErrors';
import { describeStatusMonth, pickStatusMonth } from '@/client/TeamRosterStatus';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadingState from '@/components/LoadingState';
import RosterHistoryView from '@/components/team/RosterHistoryView';
import { useTeamRostersState } from '@/components/team/UseTeamRostersState';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';
import { currentYearMonthInSeoul, formatYearMonthLabel } from '@/domain/YearMonth';

type TeamRosterSectionProps = {
  detail: TeamDetailResponse;
};

/** Status of this month's roster (or the nearest upcoming one) (none / draft in progress / published rev N), open drafts and the history. */
const TeamRosterSection = ({ detail }: TeamRosterSectionProps) => {
  const state = useTeamRostersState(detail.team.id);
  const titleId = useId();
  const teamId = detail.team.id;
  const thisMonth = currentYearMonthInSeoul(new Date());
  const rosters = state.rosters.data?.rosters ?? [];
  const drafts = rosters.filter((roster) => roster.status === TeamRosterStatus.DRAFT);
  const statusMonth = pickStatusMonth(rosters, thisMonth);
  const published = rosters.find(
    (roster) => roster.status === TeamRosterStatus.PUBLISHED && roster.yearMonth === statusMonth,
  );
  const statusDraft = drafts.find((roster) => roster.yearMonth === statusMonth || roster.yearMonth === null);

  return (
    <section aria-labelledby={titleId} className="status-card">
      <div className="tiny">{describeStatusMonth(statusMonth, thisMonth)}</div>
      <h2 id={titleId} className="mt-0">
        {formatYearMonthLabel(statusMonth)}
      </h2>
      {state.rosters.state === ScreenLoadState.LOADING && <LoadingState text="근무표를 불러오는 중이에요…" />}
      {state.rosters.state === ScreenLoadState.ERROR && (
        <div className="warning" role="alert">
          {state.rosters.errorMessage}
          <button type="button" className="secondary mt-10" onClick={state.rosters.reload}>
            다시 불러오기
          </button>
        </div>
      )}
      {state.rosters.state === ScreenLoadState.READY && (
        <p className="mb-8">
          {published
            ? `${formatRevision(published.revision ?? 0)} 배포 중 · ${formatDateTime(published.publishedAt ?? published.createdAt)}`
            : statusDraft
              ? '근무표를 확인하고 있어요. 배포하면 팀원 달력에 나타나요.'
              : '아직 배포한 근무표가 없어요. 아래 “근무표 올리기”로 시작해 주세요.'}
        </p>
      )}
      {published && (
        <div className="actionrow">
          <Link href={`/teams/${teamId}/roster/${statusMonth}`} className="secondary">
            전체 근무표
          </Link>
          <button
            type="button"
            className="secondary"
            disabled={state.busyRosterId !== null}
            onClick={() => void state.handleEdit(published)}
          >
            {state.busyRosterId === published.id ? '여는 중…' : '수정하기'}
          </button>
        </div>
      )}
      {drafts.length > 0 && (
        <ul className="team-list mt-12" aria-label="작성 중인 근무표">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <Link href={`/teams/${teamId}/rosters/${draft.id}`} className="team-item">
                <span className="team-item-body">
                  <strong>
                    {draft.yearMonth ? formatYearMonthLabel(draft.yearMonth) : '연·월 확인 중'} 초안
                    {draft.baseRevision > 0 ? ` · ${formatRevision(draft.baseRevision)} 수정` : ''}
                  </strong>
                  <small>{formatRosterProgress(draft.progress)} · 이어서 하기</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      <div className="status-line" role="status" aria-live="polite">
        {state.message}
      </div>
      <RosterHistoryView
        teamId={teamId}
        rosters={rosters}
        busyRosterId={state.busyRosterId}
        onEdit={(roster) => void state.handleEdit(roster)}
        onRevert={state.setRevertTarget}
      />
      <ConfirmDialog
        isOpen={state.revertTarget !== null}
        title={
          state.unlinkedRows
            ? '연결된 팀원의 행이 없어요'
            : `${formatRevision(state.revertTarget?.revision ?? 0)}으로 되돌릴까요?`
        }
        message={
          state.unlinkedRows
            ? formatUnlinkedWarning(state.unlinkedRows)
            : '이 버전을 새 배포본으로 다시 배포해요. 팀원 달력이 바로 바뀌고, 바뀐 날짜에 “변경” 표시가 붙어요.'
        }
        confirmLabel={state.unlinkedRows ? '그래도 되돌리기' : '되돌리기'}
        isDanger={state.unlinkedRows !== null}
        isBusy={state.busyRosterId !== null}
        onConfirm={() => void state.handleRevert(state.unlinkedRows !== null)}
        onCancel={state.handleCancelRevert}
      />
    </section>
  );
};

export default TeamRosterSection;

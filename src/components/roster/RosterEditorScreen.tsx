'use client';

import Link from 'next/link';

import { listFailedRows, mergeFailedRows } from '@/client/TeamRosterGrid';
import AuthRequired from '@/components/AuthRequired';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import RosterProgressView from '@/components/roster/RosterProgressView';
import RosterPublishedView from '@/components/roster/RosterPublishedView';
import RosterReviewView from '@/components/roster/RosterReviewView';
import { useRosterEditorState } from '@/components/roster/UseRosterEditorState';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type RosterEditorScreenProps = {
  teamId: string;
  rosterId: string;
};

/** `/teams/:id/rosters/:rid` (admin): (a) extraction progress → (b) review table → (c) publish. */
const RosterEditorScreen = ({ teamId, rosterId }: RosterEditorScreenProps) => {
  const state = useRosterEditorState(teamId, rosterId);
  const { server, view } = state;
  const teamHref = `/teams/${teamId}`;

  if (state.loadState === ScreenLoadState.LOADING || state.isRefreshing) {
    return <LoadingState text="근무표를 불러오는 중이에요…" />;
  }

  if (state.loadState === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`${teamHref}/rosters/${rosterId}`} />;
  }

  if (state.loadState !== ScreenLoadState.READY || !server || !view) {
    return (
      <RecoverableError
        title={
          state.loadState === ScreenLoadState.NOT_FOUND
            ? '근무표를 찾을 수 없어요'
            : '근무표를 불러오지 못했어요'
        }
        message={state.loadError ?? '다시 시도해 주세요.'}
        onRetry={state.loadState === ScreenLoadState.ERROR ? state.handleReload : undefined}
        alternativeHref={teamHref}
        alternativeLabel="팀으로 돌아가기"
      />
    );
  }

  if (state.publish.result) {
    return <RosterPublishedView teamId={teamId} result={state.publish.result} />;
  }

  if (server.roster.status !== TeamRosterStatus.DRAFT) {
    const month = server.roster.yearMonth;

    return (
      <EmptyState
        label="배포한 근무표"
        title="이 근무표는 이미 배포했어요"
        description="고치려면 팀 화면에서 배포 중인 근무표의 “수정하기”를 눌러 새 초안을 만들어 주세요. 예전 버전은 “되돌리기”로 다시 배포할 수 있어요."
      >
        <Link href={teamHref} className="primary">
          팀으로 돌아가기
        </Link>
        {month && (
          <Link href={`${teamHref}/roster/${month}`} className="secondary">
            {formatYearMonthLabel(month)} 전체 근무표
          </Link>
        )}
      </EmptyState>
    );
  }

  if (server.progress.phase !== TeamRosterPhase.READY) {
    return (
      <RosterProgressView
        teamHref={teamHref}
        progress={server.progress}
        failedRows={mergeFailedRows(listFailedRows(server.rows), state.extraction.failedRows)}
        isRunning={state.extraction.isRunning}
        error={state.extraction.error}
        onStart={(retryFailed) => void state.extraction.start(retryFailed)}
      />
    );
  }

  return <RosterReviewView teamId={teamId} state={state} view={view} />;
};

export default RosterEditorScreen;

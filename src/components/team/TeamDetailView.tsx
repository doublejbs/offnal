'use client';

import Link from 'next/link';

import { getTeam } from '@/client/TeamApiClient';
import AuthRequired from '@/components/AuthRequired';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import TeamAdminView from '@/components/team/TeamAdminView';
import TeamMemberHomeView from '@/components/team/TeamMemberHomeView';
import { useLoad } from '@/components/UseLoad';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamRole } from '@/domain/enums/TeamRole';

type TeamDetailViewProps = {
  teamId: string;
};

/** `/teams/:id`: admins get the management screen, members their own team page. Others see 404. */
const TeamDetailView = ({ teamId }: TeamDetailViewProps) => {
  const load = useLoad(teamId, (signal) => getTeam(teamId, signal));

  if (load.state === ScreenLoadState.LOADING) {
    return <LoadingState text="팀을 불러오는 중이에요…" />;
  }

  if (load.state === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`/teams/${teamId}`} />;
  }

  if (load.state === ScreenLoadState.NOT_FOUND) {
    return (
      <EmptyState
        label="팀"
        title="팀을 찾을 수 없어요"
        description="팀이 삭제됐거나, 아직 참여 승인을 기다리고 있거나, 팀에서 나간 상태예요."
      >
        <Link href="/teams" className="primary">
          내 팀 목록
        </Link>
      </EmptyState>
    );
  }

  if (load.state !== ScreenLoadState.READY || !load.data) {
    return (
      <RecoverableError
        title="팀을 불러오지 못했어요"
        message={load.errorMessage ?? '다시 시도해 주세요.'}
        onRetry={load.reload}
        alternativeHref="/teams"
        alternativeLabel="내 팀 목록"
      />
    );
  }

  if (load.data.myRole === TeamRole.ADMIN) {
    return <TeamAdminView detail={load.data} onDetailChange={load.setData} />;
  }

  return <TeamMemberHomeView detail={load.data} />;
};

export default TeamDetailView;

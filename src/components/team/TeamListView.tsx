'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { describeMembershipBadge } from '@/client/TeamDisplayText';
import { listTeams } from '@/client/TeamApiClient';
import AuthRequired from '@/components/AuthRequired';
import { usePublicConfig } from '@/components/ConfigProvider';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import TeamCreateForm from '@/components/team/TeamCreateForm';
import TeamIntroView from '@/components/team/TeamIntroView';
import { useLoad } from '@/components/UseLoad';
import { isBetaFree } from '@/domain/BillingPolicy';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type TeamMembershipSummary } from '@/domain/types/api/TeamMembershipSummary';

const TeamItem = ({ team }: { team: TeamMembershipSummary }) => {
  const badge = describeMembershipBadge(team.role, team.status);
  const badgeTone =
    team.status === TeamMemberStatus.PENDING ? 'pending' : team.role === TeamRole.ADMIN ? 'admin' : 'member';

  if (team.status === TeamMemberStatus.PENDING) {
    return (
      <li className="team-item" data-pending="true">
        <span className="team-item-body">
          <strong>{team.teamName}</strong>
          <small>관리자가 승인하면 팀 근무가 내 달력에 나타나요.</small>
        </span>
        <span className="role-badge" data-tone={badgeTone}>
          {badge}
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link href={`/teams/${team.teamId}`} className="team-item">
        <span className="team-item-body">
          <strong>{team.teamName}</strong>
          <small>
            {team.role === TeamRole.ADMIN ? '근무표 올리기 · 팀원 관리' : '내 근무 · 전체 근무표'}
          </small>
        </span>
        <span className="role-badge" data-tone={badgeTone}>
          {badge}
        </span>
        <ChevronRight size={18} aria-hidden="true" className="flex-none" />
      </Link>
    </li>
  );
};

/** `/teams`: my teams (PENDING shows "승인 대기"), team sharing explained when empty, and "팀 만들기". */
const TeamListView = () => {
  const load = useLoad('teams', (signal) => listTeams(signal));
  const isBeta = isBetaFree(usePublicConfig());

  if (load.state === ScreenLoadState.LOADING) {
    return <LoadingState text="내 팀을 불러오는 중이에요…" />;
  }

  if (load.state === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo="/teams" />;
  }

  if (load.state !== ScreenLoadState.READY || !load.data) {
    return (
      <RecoverableError
        title="팀 목록을 불러오지 못했어요"
        message={load.errorMessage ?? '다시 시도해 주세요.'}
        onRetry={load.reload}
      />
    );
  }

  const { teams } = load.data;

  return (
    <>
      <div className="label">팀 공유 · 베타</div>
      <h1>{teams.length > 0 ? '내 팀' : '팀이 함께 쓰는 근무 달력'}</h1>
      {teams.length === 0 ? (
        <>
          <p>근무표 담당자가 한 번 올리면, 팀원은 각자 로그인해서 자기 근무 달력을 받아요.</p>
          <TeamIntroView isBeta={isBeta} />
          <div className="notice">초대 링크를 받았다면 그 링크를 열어 참여해 주세요.</div>
        </>
      ) : (
        <ul className="team-list" aria-label="내가 속한 팀">
          {teams.map((team) => (
            <TeamItem key={team.teamId} team={team} />
          ))}
        </ul>
      )}
      <TeamCreateForm isFirstTeam={teams.length === 0} />
      <div className="center mt-16">
        <Link href="/calendar" className="textbutton">
          내 달력 보기
        </Link>
      </div>
    </>
  );
};

export default TeamListView;

'use client';

import Link from 'next/link';

import AuthRequired from '@/components/AuthRequired';
import EmptyState from '@/components/EmptyState';
import JoinRowPicker from '@/components/join/JoinRowPicker';
import { NO_ROW_CHOICE, useJoinState } from '@/components/join/UseJoinState';
import LoadingState from '@/components/LoadingState';
import LoginOptions from '@/components/LoginOptions';
import RecoverableError from '@/components/RecoverableError';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type JoinViewProps = {
  token: string;
  isLoggedIn: boolean;
};

const GONE_TEXT = '초대 링크가 만료되었거나 중지되었어요. 관리자에게 새 링크를 받아 주세요.';

const PendingNotice = ({ teamName }: { teamName: string }) => (
  <EmptyState
    label="참여 요청 완료"
    title="관리자가 승인하면 달력에 나타나요"
    description={`${teamName} 관리자가 요청을 확인하고 있어요. 승인되면 팀 근무가 내 달력에 들어가요.`}
  >
    <Link href="/teams" className="primary">
      내 팀 보기
    </Link>
  </EmptyState>
);

/** Invite page. Before login only the team name is ever fetched or shown (TeamShareSpec §4). */
const JoinView = ({ token, isLoggedIn }: JoinViewProps) => {
  const state = useJoinState(token, isLoggedIn);
  const { invite, membership, rows } = state;
  const returnTo = `/join/${encodeURIComponent(token)}`;

  if (invite.state === ScreenLoadState.LOADING) {
    return <LoadingState text="초대 링크를 확인하는 중이에요…" />;
  }

  if (invite.state === ScreenLoadState.NOT_FOUND || state.isGone) {
    return (
      <EmptyState label="팀 초대" title="열 수 없는 초대 링크예요" description={GONE_TEXT}>
        <Link href="/" className="primary">
          오프날 처음으로
        </Link>
      </EmptyState>
    );
  }

  if (invite.state !== ScreenLoadState.READY || !invite.data) {
    return (
      <RecoverableError
        title="초대 링크를 확인하지 못했어요"
        message={invite.errorMessage ?? '다시 시도해 주세요.'}
        onRetry={invite.reload}
      />
    );
  }

  const { teamName } = invite.data;

  if (state.joined || membership?.status === TeamMemberStatus.PENDING) {
    return <PendingNotice teamName={teamName} />;
  }

  if (membership?.status === TeamMemberStatus.ACTIVE) {
    return (
      <EmptyState
        label="팀 초대"
        title={`이미 ${teamName} 팀원이에요`}
        description="팀 근무는 내 달력에서 볼 수 있어요."
      >
        <Link href={`/teams/${membership.teamId}`} className="primary">
          팀으로 가기
        </Link>
      </EmptyState>
    );
  }

  if (!isLoggedIn) {
    return (
      <section aria-labelledby="join-title">
        <div className="label">팀 초대</div>
        <h1 id="join-title">{teamName}</h1>
        <p>
          관리자가 올린 근무표에서 내 이름을 고르면, 승인 후 내 근무가 달력에 들어가요. 사진을 따로 올릴
          필요가 없어요.
        </p>
        <div className="block">
          <h2>참여하려면 로그인</h2>
          <p>로그인한 뒤 이 화면으로 돌아와 이름을 고를 수 있어요.</p>
          <LoginOptions returnTo={returnTo} primaryLabel="로그인하고 참여하기" />
        </div>
      </section>
    );
  }

  if (rows.state === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={returnTo} />;
  }

  const hasRoster = rows.data?.yearMonth !== null && rows.data?.yearMonth !== undefined;

  return (
    <section aria-labelledby="join-title">
      <div className="label">팀 초대</div>
      <h1 id="join-title">{teamName}</h1>
      {rows.state === ScreenLoadState.LOADING && <LoadingState text="근무표 이름을 불러오는 중이에요…" />}
      {rows.state === ScreenLoadState.ERROR && (
        <div className="warning" role="alert">
          {rows.errorMessage}
        </div>
      )}
      {rows.data && hasRoster && (
        <>
          <p>
            {formatYearMonthLabel(rows.data.yearMonth ?? '')} 근무표 기준이에요. 같은 이름이 여럿이면 첫 3일
            근무로 구분해 주세요.
          </p>
          <JoinRowPicker
            rows={rows.data.rows}
            choice={state.choice}
            disabled={state.isBusy}
            onChange={state.setChoice}
          />
        </>
      )}
      {rows.data && !hasRoster && (
        <div className="notice">
          아직 배포된 근무표가 없어요. 관리자가 근무표를 올리면 내 이름을 고를 수 있어요. 지금 참여를 요청해
          두면 관리자가 승인할 때 이름을 연결해 줘요.
        </div>
      )}
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      <button
        type="button"
        className="primary mt-16"
        disabled={state.isBusy || !rows.data || (hasRoster && state.choice === null)}
        onClick={() => void state.handleJoin(hasRoster ? state.choice : NO_ROW_CHOICE)}
      >
        {state.isBusy ? '요청하는 중…' : '참여 요청 보내기'}
      </button>
      <div className="hint">관리자가 승인하기 전에는 팀 근무표를 볼 수 없어요.</div>
    </section>
  );
};

export default JoinView;

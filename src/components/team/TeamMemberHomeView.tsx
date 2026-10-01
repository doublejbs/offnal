'use client';

import Link from 'next/link';

import { formatDateTime } from '@/client/DisplayText';
import { formatRevision, formatRowKey, formatRowName } from '@/client/TeamDisplayText';
import { getMyTeamMonths } from '@/client/TeamApiClient';
import BackLink from '@/components/BackLink';
import LeaveTeamButton from '@/components/team/LeaveTeamButton';
import { useLoad } from '@/components/UseLoad';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type TeamMemberHomeViewProps = {
  detail: TeamDetailResponse;
};

/** Member view of `/teams/:id`: my linked row, my team months, the full roster (when shared) and leaving. */
const TeamMemberHomeView = ({ detail }: TeamMemberHomeViewProps) => {
  const { team } = detail;
  const myMonths = useLoad(`my-months-${team.id}`, (signal) => getMyTeamMonths(team.id, signal));
  const months = myMonths.data?.months ?? [];
  const latestMonth = months.at(-1);
  const linkedKeyName = detail.myLinkedRowKey ? formatRowKey(detail.myLinkedRowKey) : null;
  const myName = latestMonth ? formatRowName(latestMonth) : linkedKeyName;
  const latest = detail.publishedMonths.at(-1);

  return (
    <>
      <BackLink href="/teams" label="내 팀" />
      <div className="label">팀원</div>
      <h1>{team.name}</h1>
      <div className="block">
        <h2>근무표 속 내 이름</h2>
        {myName ? (
          <p className="mb-0">
            <strong className="ink">{myName}</strong>
            <br />
            이름이 틀렸거나 다른 사람으로 연결됐다면 관리자에게 알려 주세요.
          </p>
        ) : (
          <p className="mb-0">
            아직 근무표의 행과 연결되지 않았어요. 관리자가 근무표를 올리고 내 이름을 연결하면 달력에 나타나요.
          </p>
        )}
      </div>
      <section aria-labelledby="team-my-months">
        <h2 id="team-my-months">내 달력에 들어간 팀 근무</h2>
        {months.length === 0 ? (
          <p>아직 배포된 근무가 없어요.</p>
        ) : (
          <ul className="team-list">
            {months.map((month) => (
              <li key={month.yearMonth}>
                <Link href={`/calendar/${month.yearMonth}`} className="team-item">
                  <span className="team-item-body">
                    <strong>{formatYearMonthLabel(month.yearMonth)}</strong>
                    <small>
                      {formatRevision(month.revision)} · {formatDateTime(month.publishedAt)}
                      {month.changes.length > 0 ? ` · 바뀐 날 ${month.changes.length}일` : ''}
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {latest &&
        (team.shareRosterWithMembers ? (
          <Link href={`/teams/${team.id}/roster/${latest.yearMonth}`} className="secondary mt-16">
            {formatYearMonthLabel(latest.yearMonth)} 전체 근무표 보기
          </Link>
        ) : (
          <div className="notice">관리자가 전체 근무표 공개를 꺼 두었어요. 내 근무만 볼 수 있어요.</div>
        ))}
      <div className="notice">
        팀 근무는 관리자가 관리해요. 틀린 곳이 있으면 관리자에게 수정을 요청해 주세요.
      </div>
      <LeaveTeamButton teamId={team.id} teamName={team.name} />
    </>
  );
};

export default TeamMemberHomeView;

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { formatDateTime, formatLegendText } from '@/client/DisplayText';
import { getShiftTone, toneClassName } from '@/client/ShiftStyle';
import { getTeam, getTeamRosterView } from '@/client/TeamApiClient';
import { formatRevision } from '@/client/TeamDisplayText';
import AuthRequired from '@/components/AuthRequired';
import BackLink from '@/components/BackLink';
import MonthSwitcher from '@/components/calendar/MonthSwitcher';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import TeamRosterTable from '@/components/roster/TeamRosterTable';
import { useLoad } from '@/components/UseLoad';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamRole } from '@/domain/enums/TeamRole';
import { filterUsedDefinitions } from '@/domain/UsedDefinitions';
import { formatYearMonthLabel, listDates } from '@/domain/YearMonth';

type TeamRosterReadViewProps = {
  teamId: string;
  yearMonth: string;
};

const SHARING_OFF_TEXT = '관리자가 전체 근무표 공개를 꺼 두었어요. 내 근무는 내 달력에서 볼 수 있어요.';

/** `/teams/:id/roster/:ym`: the latest published roster (members while sharing is on, admins always). */
const TeamRosterReadView = ({ teamId, yearMonth }: TeamRosterReadViewProps) => {
  const router = useRouter();
  const roster = useLoad(`${teamId}-${yearMonth}`, (signal) => getTeamRosterView(teamId, yearMonth, signal));
  const team = useLoad(teamId, (signal) => getTeam(teamId, signal));
  const teamHref = `/teams/${teamId}`;

  if (roster.state === ScreenLoadState.LOADING) {
    return <LoadingState text="전체 근무표를 불러오는 중이에요…" />;
  }

  if (roster.state === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`${teamHref}/roster/${yearMonth}`} />;
  }

  if (roster.state === ScreenLoadState.NOT_FOUND) {
    const isSharingOff =
      team.data !== null && team.data.myRole === TeamRole.MEMBER && !team.data.team.shareRosterWithMembers;

    return (
      <EmptyState
        label="전체 근무표"
        title={isSharingOff ? '전체 근무표가 비공개예요' : '이 달 근무표를 볼 수 없어요'}
        description={
          isSharingOff ? SHARING_OFF_TEXT : '아직 배포된 근무표가 없거나, 볼 수 있는 팀이 아니에요.'
        }
      >
        <Link href={team.data ? teamHref : '/teams'} className="primary">
          {team.data ? '팀으로 돌아가기' : '내 팀 목록'}
        </Link>
      </EmptyState>
    );
  }

  if (roster.state !== ScreenLoadState.READY || !roster.data) {
    return (
      <RecoverableError
        title="전체 근무표를 불러오지 못했어요"
        message={roster.errorMessage ?? '다시 시도해 주세요.'}
        onRetry={roster.reload}
      />
    );
  }

  const data = roster.data;
  const months = team.data?.publishedMonths.map((month) => month.yearMonth) ?? [];
  const legend = filterUsedDefinitions(
    data.definitions,
    data.rows.flatMap((row) =>
      row.entries.map((entry) => ({ ...entry, reviewReasons: [], confirmed: true })),
    ),
  );

  return (
    <div className="roster-wide">
      <BackLink href={teamHref} label="팀으로" />
      <div className="label">{data.teamName} · 전체 근무표</div>
      <h1>{formatYearMonthLabel(data.yearMonth)}</h1>
      <div className="tiny">
        {formatRevision(data.revision)} · {formatDateTime(data.publishedAt)} 배포 · {data.rows.length}명
      </div>
      <MonthSwitcher
        months={months}
        current={yearMonth}
        onChange={(next) => router.push(`${teamHref}/roster/${next}`)}
      />
      {data.myRowKey === null && <div className="notice">근무표에 연결된 내 행이 없어요.</div>}
      <div className="mt-12">
        <TeamRosterTable rows={data.rows} dates={listDates(data.yearMonth)} definitions={data.definitions} />
      </div>
      {legend.length > 0 && (
        <ul className="roster-legend" aria-label="근무 코드">
          {legend.map((definition) => (
            <li key={definition.code}>
              <span className={toneClassName(getShiftTone(definition.code, data.definitions))}>
                {definition.code}
              </span>{' '}
              {formatLegendText(definition)}
            </li>
          ))}
        </ul>
      )}
      <div className="hint">팀이 배포한 근무표예요. 틀린 곳이 있으면 관리자에게 알려 주세요.</div>
    </div>
  );
};

export default TeamRosterReadView;

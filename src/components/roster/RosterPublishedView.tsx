import { CircleCheck } from 'lucide-react';
import Link from 'next/link';

import { formatRevision } from '@/client/TeamDisplayText';
import { type PublishTeamRosterResponse } from '@/domain/types/api/PublishTeamRosterResponse';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type RosterPublishedViewProps = {
  teamId: string;
  result: PublishTeamRosterResponse;
};

/** Phase (c) done: members' calendars already show this revision. */
const RosterPublishedView = ({ teamId, result }: RosterPublishedViewProps) => (
  <section aria-labelledby="roster-published-title">
    <div className="label">배포 완료</div>
    <h1 id="roster-published-title">
      <CircleCheck size={26} aria-hidden="true" className="icon-inline mr-6" />
      {formatYearMonthLabel(result.yearMonth)} 근무표를 배포했어요
    </h1>
    <p>
      {formatRevision(result.revision)}
      {result.changedCellCount > 0 ? ` · 바뀐 칸 ${result.changedCellCount}개` : ''}. 승인된 팀원 달력에 바로
      나타나요{result.changedCellCount > 0 ? '. 바뀐 날짜에는 “변경” 표시가 붙어요' : ''}.
    </p>
    <div className="notice">
      캘린더 앱으로 이미 가져간 일정은 자동으로 바뀌지 않아요. 팀원에게 “캘린더에 다시 추가”를 안내해 주세요.
    </div>
    <div className="stack">
      <Link href={`/teams/${teamId}`} className="primary">
        팀으로 돌아가기
      </Link>
      <Link href={`/teams/${teamId}/roster/${result.yearMonth}`} className="secondary">
        전체 근무표 보기
      </Link>
    </div>
  </section>
);

export default RosterPublishedView;

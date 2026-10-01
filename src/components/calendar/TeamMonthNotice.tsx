import Link from 'next/link';

import { formatDateTime } from '@/client/DisplayText';
import { formatMemberChanges, formatRevision } from '@/client/TeamDisplayText';
import { type TeamMonthInfo } from '@/domain/types/api/TeamMonthInfo';

type TeamMonthNoticeProps = {
  team: TeamMonthInfo;
  hasPersonalBackup: boolean;
  isAcking: boolean;
  onAck: () => void;
};

/**
 * A team month in the member's calendar: read-only notice, and when the roster changed since the last
 * acknowledged revision the changed dates + "캘린더에 다시 추가" (ICS never updates by itself, Handoff §8).
 */
const TeamMonthNotice = ({ team, hasPersonalBackup, isAcking, onAck }: TeamMonthNoticeProps) => (
  <>
    {team.changes.length > 0 && (
      <div className="warning">
        <div role="status">
          <strong>근무가 바뀌었어요</strong>
          <div>{formatMemberChanges(team.changes)}</div>
        </div>
        <div className="mt-8">
          캘린더 앱에 이미 추가한 일정은 자동으로 바뀌지 않아요. “공유·내보내기”에서 캘린더에 다시 추가해
          주세요.
        </div>
        <button type="button" className="secondary mt-10" disabled={isAcking} onClick={onAck}>
          {isAcking ? '처리 중…' : '확인했어요'}
        </button>
      </div>
    )}
    <div className="notice">
      팀 관리자가 배포한 근무예요 ({formatRevision(team.revision)} · {formatDateTime(team.publishedAt)}). 직접
      고칠 수 없으니, 틀린 곳이 있으면 관리자에게 수정을 요청해 주세요.
      {hasPersonalBackup && ' 이 달에 직접 저장했던 개인 달력은 지우지 않고 보관하고 있어요.'}
      <div className="mt-8">
        <Link href={`/teams/${team.teamId}`}>{team.teamName} 화면으로</Link>
      </div>
    </div>
  </>
);

export default TeamMonthNotice;

'use client';

import Link from 'next/link';
import { useId } from 'react';

import { formatDateTime } from '@/client/DisplayText';
import { formatRevision } from '@/client/TeamDisplayText';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type TeamRosterSummaryDto } from '@/domain/types/api/TeamRosterSummaryDto';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type RosterHistoryViewProps = {
  teamId: string;
  rosters: TeamRosterSummaryDto[];
  busyRosterId: string | null;
  onEdit: (roster: TeamRosterSummaryDto) => void;
  onRevert: (roster: TeamRosterSummaryDto) => void;
};

/** Published and archived revisions by month (newest first): view / 수정하기 on the current one, 되돌리기 on older ones. */
const RosterHistoryView = ({ teamId, rosters, busyRosterId, onEdit, onRevert }: RosterHistoryViewProps) => {
  const titleId = useId();
  const released = rosters.filter((roster) => roster.status !== TeamRosterStatus.DRAFT && roster.yearMonth);
  const months = [...new Set(released.map((roster) => roster.yearMonth ?? ''))].sort().reverse();

  if (months.length === 0) {
    return null;
  }

  return (
    <details className="mt-12">
      <summary className="summary" id={titleId}>
        배포 기록 · 되돌리기
      </summary>
      {months.map((month) => (
        <section key={month} aria-label={formatYearMonthLabel(month)} className="history-month">
          <h3>{formatYearMonthLabel(month)}</h3>
          <ul className="history-list">
            {released
              .filter((roster) => roster.yearMonth === month)
              .map((roster) => {
                const isCurrent = roster.status === TeamRosterStatus.PUBLISHED;

                return (
                  <li key={roster.id} className="history-item">
                    <span className="min-w-0">
                      <strong>{formatRevision(roster.revision ?? 0)}</strong>
                      {isCurrent && (
                        <span className="role-badge" data-tone="admin">
                          배포 중
                        </span>
                      )}
                      <small className="block-text tiny">
                        {formatDateTime(roster.publishedAt ?? roster.createdAt)}
                      </small>
                    </span>
                    {isCurrent ? (
                      <span className="history-actions">
                        <Link href={`/teams/${teamId}/roster/${month}`} className="textbutton">
                          보기
                        </Link>
                        <button
                          type="button"
                          className="textbutton"
                          disabled={busyRosterId !== null}
                          onClick={() => onEdit(roster)}
                        >
                          수정하기
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="textbutton"
                        disabled={busyRosterId !== null}
                        aria-label={`${formatYearMonthLabel(month)} ${formatRevision(roster.revision ?? 0)}으로 되돌리기`}
                        onClick={() => onRevert(roster)}
                      >
                        되돌리기
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </details>
  );
};

export default RosterHistoryView;

import { WEEKDAY_LABELS } from '@/client/MonthLayout';
import { getShiftTone, toneClassName } from '@/client/ShiftStyle';
import { formatSameNameLabel } from '@/client/TeamDisplayText';
import { countShiftsByDate, type DayShiftCounts } from '@/client/TeamRosterGrid';
import { type TeamRosterViewRow } from '@/domain/types/api/TeamRosterViewRow';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { dayOfDate, weekdayOf } from '@/domain/YearMonth';

const COUNT_ROWS: { label: string; read: (counts: DayShiftCounts) => number }[] = [
  { label: 'D 인원', read: (counts) => counts.day },
  { label: 'E 인원', read: (counts) => counts.evening },
  { label: 'N 인원', read: (counts) => counts.night },
];

type TeamRosterTableProps = {
  rows: TeamRosterViewRow[];
  dates: string[];
  definitions: ShiftDefinition[];
};

/** Read-only published roster: sticky names, my row highlighted, per-day D/E/N head counts in the footer. */
const TeamRosterTable = ({ rows, dates, definitions }: TeamRosterTableProps) => {
  const counts = countShiftsByDate(rows, dates, definitions);

  return (
    <div className="roster-scroll" role="region" aria-label="전체 근무표" tabIndex={0}>
      <table className="roster-table is-readonly">
        <thead>
          <tr>
            <th scope="col" className="roster-name">
              이름
            </th>
            {dates.map((date) => (
              <th key={date} scope="col" data-weekend={weekdayOf(date) === 0 || weekdayOf(date) === 6}>
                <span className="block-text">{dayOfDate(date)}</span>
                <span className="tiny">{WEEKDAY_LABELS[weekdayOf(date)]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const codeByDate = new Map(row.entries.map((entry) => [entry.date, entry.code]));

            return (
              <tr key={row.rowKey} data-mine={row.isMine}>
                <th scope="row" className="roster-name">
                  {formatSameNameLabel(row.displayName, row.sameNameOrdinal, row.sameNameCount)}
                  {row.isMine && <span className="tiny block-text">나</span>}
                </th>
                {dates.map((date) => {
                  const code = codeByDate.get(date) ?? null;

                  return (
                    <td key={date}>
                      {code ? (
                        <span className={toneClassName(getShiftTone(code, definitions))}>{code}</span>
                      ) : (
                        <span className="visually-hidden">근무 없음</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {COUNT_ROWS.map((countRow) => (
            <tr key={countRow.label}>
              <th scope="row" className="roster-name">
                {countRow.label}
              </th>
              {dates.map((date) => {
                const count = counts.get(date);

                return (
                  <td key={date} className="roster-count">
                    {count ? countRow.read(count) : 0}
                  </td>
                );
              })}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
};

export default TeamRosterTable;

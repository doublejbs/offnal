'use client';

import { type KeyboardEvent, useRef } from 'react';

import { formatMonthDay, WEEKDAY_LABELS } from '@/client/MonthLayout';
import { describeEntryStatus, getBadgeText, getEntryTone, toneClassName } from '@/client/ShiftStyle';
import { formatRowName } from '@/client/TeamDisplayText';
import { findGridTarget } from '@/client/TeamRosterGrid';
import { type RosterCell } from '@/components/roster/UseRosterReviewState';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { dayOfDate, weekdayOf } from '@/domain/YearMonth';

type RosterGridViewProps = {
  rows: TeamRosterRowDto[];
  dates: string[];
  definitions: ShiftDefinition[];
  selected: RosterCell | null;
  onSelect: (cell: RosterCell) => void;
};

const cellKey = (rowId: string, date: string): string => `${rowId}:${date}`;

/**
 * Desktop review table: people × days, sticky name column, horizontal scroll contained in the table.
 * One tab stop (the selected cell); arrow keys / Home / End move the selection (roving focus).
 */
const RosterGridView = ({ rows, dates, definitions, selected, onSelect }: RosterGridViewProps) => {
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const firstRow = rows[0];
  const tabStop = selected ?? (firstRow && dates[0] ? { rowId: firstRow.id, date: dates[0] } : null);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) => {
    const target = findGridTarget(
      event.key,
      { row: rowIndex, column: columnIndex },
      rows.length,
      dates.length,
    );
    const row = target ? rows[target.row] : undefined;
    const date = target ? dates[target.column] : undefined;

    if (!row || !date) {
      return;
    }

    event.preventDefault();
    onSelect({ rowId: row.id, date });
    buttonsRef.current.get(cellKey(row.id, date))?.focus();
  };

  const register = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) {
      buttonsRef.current.set(key, element);
    } else {
      buttonsRef.current.delete(key);
    }
  };

  return (
    <div className="roster-scroll" role="region" aria-label="전체 근무표 확인 표" tabIndex={-1}>
      <table className="roster-table">
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
          {rows.map((row, rowIndex) => {
            const entryByDate = new Map(row.entries.map((entry) => [entry.date, entry]));
            const name = formatRowName(row);

            return (
              <tr key={row.id} data-excluded={row.excluded}>
                <th scope="row" className="roster-name">
                  <span className="block-text">{name}</span>
                  <span className="tiny">
                    {row.excluded ? '제외됨' : row.reviewCount > 0 ? `확인 ${row.reviewCount}` : '완료'}
                  </span>
                </th>
                {dates.map((date, columnIndex) => {
                  const entry = entryByDate.get(date) ?? {
                    date,
                    code: null,
                    reviewReasons: [],
                    confirmed: false,
                  };
                  const key = cellKey(row.id, date);
                  const isSelected = selected?.rowId === row.id && selected.date === date;

                  return (
                    <td key={date}>
                      <button
                        ref={register(key)}
                        type="button"
                        className="roster-cell"
                        data-cell={key}
                        tabIndex={tabStop?.rowId === row.id && tabStop.date === date ? 0 : -1}
                        aria-pressed={isSelected}
                        aria-label={`${name} ${formatMonthDay(date)} ${row.excluded ? '제외된 행' : describeEntryStatus(entry)}`}
                        onClick={() => onSelect({ rowId: row.id, date })}
                        onKeyDown={(event) => handleKeyDown(event, rowIndex, columnIndex)}
                      >
                        {row.excluded ? (
                          <span aria-hidden="true">-</span>
                        ) : (
                          <span className={toneClassName(getEntryTone(entry, definitions))}>
                            {getBadgeText(entry)}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RosterGridView;

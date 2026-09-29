'use client';

import { type KeyboardEvent, useRef } from 'react';

import { buildMonthWeeks, formatMonthDay, WEEKDAY_LABELS } from '@/client/MonthLayout';
import {
  describeEntryStatus,
  getBadgeText,
  getEntryTone,
  getShiftTone,
  toneClassName,
} from '@/client/ShiftStyle';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { addDaysToDate, yearMonthOfDate } from '@/domain/YearMonth';

type MonthGridProps = {
  yearMonth: string;
  entries: ShiftEntry[];
  definitions: ShiftDefinition[];
  selectedDate: string | null;
  onSelectDate?: (date: string) => void;
  showLegend?: boolean;
};

const KEY_OFFSETS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * 7-column month; every day is a toggle button whose label spells out the shift and review state.
 * Without `onSelectDate` it renders a static preview (no buttons).
 */
const MonthGrid = ({
  yearMonth,
  entries,
  definitions,
  selectedDate,
  onSelectDate,
  showLegend = true,
}: MonthGridProps) => {
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const entryByDate = new Map(entries.map((entry) => [entry.date, entry]));
  const usedCodes = new Set(entries.map((entry) => entry.code));
  const legend = definitions.filter((definition) => usedCodes.has(definition.code));

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const offset = KEY_OFFSETS[event.key];

    if (offset === undefined) {
      return;
    }

    const target = addDaysToDate(date, offset);

    if (yearMonthOfDate(target) !== yearMonth) {
      return;
    }

    event.preventDefault();
    onSelectDate?.(target);
    buttonsRef.current.get(target)?.focus();
  };

  const registerButton = (date: string) => (element: HTMLButtonElement | null) => {
    if (element) {
      buttonsRef.current.set(date, element);
    } else {
      buttonsRef.current.delete(date);
    }
  };

  return (
    <div>
      <div className="week" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="grid">
        {buildMonthWeeks(yearMonth)
          .flat()
          .map((date, index) => {
            if (date === null) {
              return <span key={`blank-${index}`} aria-hidden="true" />;
            }

            const entry = entryByDate.get(date) ?? { date, code: null, reviewReasons: [], confirmed: false };
            const label = `${formatMonthDay(date)} ${describeEntryStatus(entry)}`;
            const content = (
              <>
                <span>{Number(date.slice(8))}</span>
                <span className={toneClassName(getEntryTone(entry, definitions))}>{getBadgeText(entry)}</span>
              </>
            );

            if (!onSelectDate) {
              return (
                <div key={date} className="day" role="img" aria-label={label}>
                  {content}
                </div>
              );
            }

            return (
              <button
                key={date}
                ref={registerButton(date)}
                type="button"
                className="day"
                aria-pressed={selectedDate === date}
                aria-label={label}
                onClick={() => onSelectDate(date)}
                onKeyDown={(event) => handleKeyDown(event, date)}
              >
                {content}
              </button>
            );
          })}
      </div>
      {showLegend && legend.length > 0 && (
        <div className="legend">
          {legend.map((definition) => (
            <span key={definition.code}>
              <span className={toneClassName(getShiftTone(definition.code, definitions))}>
                {definition.code}
              </span>{' '}
              {definition.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default MonthGrid;

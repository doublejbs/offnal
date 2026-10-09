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
import { useTodayInSeoul } from '@/components/calendar/UseTodayInSeoul';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { filterUsedDefinitions } from '@/domain/UsedDefinitions';
import { addDaysToDate, dayOfDate, listDates, yearMonthOfDate } from '@/domain/YearMonth';

type MonthGridProps = {
  yearMonth: string;
  entries: ShiftEntry[];
  definitions: ShiftDefinition[];
  selectedDate: string | null;
  onSelectDate?: (date: string) => void;
  showLegend?: boolean;
  /** Team months: dates changed since the member's acknowledged revision ("변경" mark). */
  changedDates?: string[];
  /** Marks today's date (Seoul). Off for the PNG export preview: a saved image outlives "today". */
  showToday?: boolean;
  /** Overrides the mounted-clock "today" (tests render on the server, where the hook yields null). */
  today?: string | null;
};

const KEY_OFFSETS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * 7-column month; every day is a toggle button whose label spells out the shift and review state.
 * Roving tabindex: the grid is a single tab stop (the selected day) and arrow keys move/select days.
 * Without `onSelectDate` it renders a static preview (no buttons).
 */
const MonthGrid = ({
  yearMonth,
  entries,
  definitions,
  selectedDate,
  onSelectDate,
  showLegend = true,
  changedDates = [],
  showToday = true,
  today: todayOverride,
}: MonthGridProps) => {
  const seoulToday = useTodayInSeoul();
  const today = showToday ? (todayOverride === undefined ? seoulToday : todayOverride) : null;
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const entryByDate = new Map(entries.map((entry) => [entry.date, entry]));
  const legend = filterUsedDefinitions(definitions, entries);
  const dates = listDates(yearMonth);
  const tabStop = selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0];

  const findKeyTarget = (key: string, date: string): string | undefined => {
    if (key === 'Home') {
      return dates[0];
    }

    if (key === 'End') {
      return dates.at(-1);
    }

    const offset = KEY_OFFSETS[key];

    return offset === undefined ? undefined : addDaysToDate(date, offset);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const target = findKeyTarget(event.key, date);

    if (!target || yearMonthOfDate(target) !== yearMonth) {
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
      <div
        className="grid"
        role={onSelectDate ? 'group' : undefined}
        aria-label={onSelectDate ? '날짜 선택' : undefined}
      >
        {buildMonthWeeks(yearMonth)
          .flat()
          .map((date, index) => {
            if (date === null) {
              return <span key={`blank-${index}`} aria-hidden="true" />;
            }

            const entry = entryByDate.get(date) ?? { date, code: null, reviewReasons: [], confirmed: false };
            const isChanged = changedDates.includes(date);
            const isToday = date === today;
            const label = `${isToday ? '오늘, ' : ''}${formatMonthDay(date)} ${describeEntryStatus(entry)}${isChanged ? ' 변경됨' : ''}`;
            const content = (
              <>
                <span className={isToday ? 'today-mark' : undefined}>{dayOfDate(date)}</span>
                <span className={toneClassName(getEntryTone(entry, definitions))}>{getBadgeText(entry)}</span>
                {isChanged && (
                  <span className="changed-mark" aria-hidden="true">
                    변경
                  </span>
                )}
              </>
            );

            if (!onSelectDate) {
              return (
                <div
                  key={date}
                  className="day"
                  role="img"
                  aria-label={label}
                  aria-current={isToday ? 'date' : undefined}
                >
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
                tabIndex={date === tabStop ? 0 : -1}
                aria-pressed={selectedDate === date}
                aria-label={label}
                aria-current={isToday ? 'date' : undefined}
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

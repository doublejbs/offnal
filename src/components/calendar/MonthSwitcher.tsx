'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { findAdjacentMonth } from '@/client/MonthLayout';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type MonthSwitcherProps = {
  months: string[];
  current: string;
  onChange: (yearMonth: string) => void;
};

/** Previous / next / pick among the given (published or shared) months only. */
const MonthSwitcher = ({ months, current, onChange }: MonthSwitcherProps) => {
  const previous = findAdjacentMonth(months, current, -1);
  const next = findAdjacentMonth(months, current, 1);
  const options = months.includes(current) ? months : [...months, current].sort();

  if (months.length <= 1) {
    return null;
  }

  return (
    <div className="month-switch">
      <button
        type="button"
        className="icon-button"
        aria-label={previous ? `이전 달 ${formatYearMonthLabel(previous)}` : '이전 달 없음'}
        disabled={!previous}
        onClick={() => previous && onChange(previous)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <select aria-label="월 선택" value={current} onChange={(event) => onChange(event.target.value)}>
        {options.map((month) => (
          <option key={month} value={month}>
            {formatYearMonthLabel(month)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-button"
        aria-label={next ? `다음 달 ${formatYearMonthLabel(next)}` : '다음 달 없음'}
        disabled={!next}
        onClick={() => next && onChange(next)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
};

export default MonthSwitcher;

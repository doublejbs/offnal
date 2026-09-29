import { dayOfDate, listDates, parseDate, weekdayOf } from '@/domain/YearMonth';

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const DAYS_PER_WEEK = 7;

/** Calendar rows of 7 cells (Sunday first). `null` cells are leading/trailing blanks. */
export const buildMonthWeeks = (yearMonth: string): (string | null)[][] => {
  const dates = listDates(yearMonth);
  const [firstDate] = dates;
  const leadingBlanks = firstDate ? weekdayOf(firstDate) : 0;
  const cells: (string | null)[] = [...Array.from({ length: leadingBlanks }, () => null), ...dates];

  while (cells.length % DAYS_PER_WEEK !== 0) {
    cells.push(null);
  }

  const weeks: (string | null)[][] = [];

  for (let index = 0; index < cells.length; index += DAYS_PER_WEEK) {
    weeks.push(cells.slice(index, index + DAYS_PER_WEEK));
  }

  return weeks;
};

/** "10월 14일" */
export const formatMonthDay = (date: string): string => {
  const parts = parseDate(date);

  if (!parts) {
    return date;
  }

  return `${parts.month}월 ${parts.day}일`;
};

/** "10월 14일 (수)" */
export const formatDayLabel = (date: string): string =>
  `${formatMonthDay(date)} (${WEEKDAY_LABELS[weekdayOf(date)] ?? ''})`;

/** "14일" */
export const formatDayOnly = (date: string): string => `${dayOfDate(date)}일`;

/** Previous (delta -1) or next (+1) month among an ascending list, relative to `current`. */
export const findAdjacentMonth = (months: string[], current: string, delta: number): string | null => {
  const sorted = [...months].sort();

  if (delta < 0) {
    return sorted.filter((month) => month < current).at(-1) ?? null;
  }

  return sorted.find((month) => month > current) ?? null;
};

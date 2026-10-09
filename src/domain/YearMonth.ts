import { MS_PER_DAY } from '@/domain/DomainLimits';
import { getZonedParts, SEOUL_TIMEZONE, zonedWallTimeToUtc } from '@/domain/TimeZone';
import { type DateParts } from '@/domain/types/DateParts';
import { type YearMonthParts } from '@/domain/types/YearMonthParts';

const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatYearMonth = (year: number, month: number): string => `${year}-${pad2(month)}`;

export const toDateString = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

export const parseYearMonth = (value: string): YearMonthParts | null => {
  const match = YEAR_MONTH_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
};

export const isValidYearMonth = (value: string): boolean => parseYearMonth(value) !== null;

const requireYearMonth = (value: string): YearMonthParts => {
  const parts = parseYearMonth(value);

  if (!parts) {
    throw new Error(`Invalid year-month: ${value}`);
  }

  return parts;
};

const daysInParts = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const daysInMonth = (yearMonth: string): number => {
  const { year, month } = requireYearMonth(yearMonth);

  return daysInParts(year, month);
};

export const listDates = (yearMonth: string): string[] => {
  const { year, month } = requireYearMonth(yearMonth);

  return Array.from({ length: daysInParts(year, month) }, (_, index) => toDateString(year, month, index + 1));
};

export const parseDate = (value: string): DateParts | null => {
  const match = DATE_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!parseYearMonth(formatYearMonth(year, month)) || day < 1 || day > daysInParts(year, month)) {
    return null;
  }

  return { year, month, day };
};

export const isValidDate = (value: string): boolean => parseDate(value) !== null;

const requireDate = (value: string): DateParts => {
  const parts = parseDate(value);

  if (!parts) {
    throw new Error(`Invalid date: ${value}`);
  }

  return parts;
};

export const dayOfDate = (date: string): number => requireDate(date).day;

export const yearMonthOfDate = (date: string): string => {
  const { year, month } = requireDate(date);

  return formatYearMonth(year, month);
};

/** Weekday of a calendar date (already expressed in the Seoul calendar), 0 = Sunday. */
export const weekdayOf = (date: string): number => {
  const { year, month, day } = requireDate(date);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/** Shifts calendar date parts by whole days. Only the input is range-checked by callers; the result may leave 2000–2100. */
export const shiftDateParts = (parts: DateParts, days: number): DateParts => {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY);

  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};

export const addDaysToDate = (date: string, days: number): string => {
  const { year, month, day } = shiftDateParts(requireDate(date), days);

  return toDateString(year, month, day);
};

export const currentYearMonthInSeoul = (now: Date): string => {
  const parts = getZonedParts(now, SEOUL_TIMEZONE);

  return formatYearMonth(parts.year, parts.month);
};

export const todayInSeoul = (now: Date): string => {
  const parts = getZonedParts(now, SEOUL_TIMEZONE);

  return toDateString(parts.year, parts.month, parts.day);
};

/** Milliseconds from `now` until the next 00:00 in Seoul (always > 0; exactly at midnight it is a full day). */
export const msUntilNextSeoulMidnight = (now: Date): number => {
  const tomorrow = shiftDateParts(getZonedParts(now, SEOUL_TIMEZONE), 1);
  const midnight = zonedWallTimeToUtc({ ...tomorrow, hour: 0, minute: 0 }, SEOUL_TIMEZONE);

  return midnight.getTime() - now.getTime();
};

export const nextYearMonth = (yearMonth: string): string => {
  const { year, month } = requireYearMonth(yearMonth);

  if (month === 12) {
    return formatYearMonth(year + 1, 1);
  }

  return formatYearMonth(year, month + 1);
};

export const formatYearMonthLabel = (yearMonth: string): string => {
  const { year, month } = requireYearMonth(yearMonth);

  return `${year}년 ${month}월`;
};

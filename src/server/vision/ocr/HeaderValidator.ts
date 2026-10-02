/** Day columns found in a header row read with a digit whitelist (Spec §20). */
export type DayHeader = {
  /** Column index (among the columns read) holding day 1. */
  firstColumn: number;
  /** Number of days N (columns firstColumn … firstColumn + N − 1 are days 1 … N). */
  dayCount: number;
  /** Days 1…N whose column read exactly its day number. */
  matchedDays: number;
};

export const MIN_DAYS_IN_MONTH = 28;
export const MAX_DAYS_IN_MONTH = 31;
/** At least this share of days 1…N must read their own number (OCR misses a few). */
export const MIN_HEADER_MATCH_SHARE = 0.7;

/** Day 1 may sit at most this many columns from the left (the name column comes first). */
const MAX_FIRST_COLUMN = 3;

/** Parses a cell's digits (`"1"`, `" 31 "`); anything else (empty, junk, out of range) is null. */
export const parseDayNumber = (text: string): number | null => {
  const digits = text.replace(/\s+/gu, '');

  if (!/^\d{1,2}$/u.test(digits)) {
    return null;
  }

  const value = Number(digits);

  return value >= 1 && value <= MAX_DAYS_IN_MONTH ? value : null;
};

/**
 * Validates day-number contiguity: day d must sit at column firstColumn + d − 1. Tries every plausible
 * first column, keeps the best alignment, and takes N = the last day that read its own number (a month has
 * 28–31 days). Returns null when fewer than MIN_HEADER_MATCH_SHARE of days 1…N line up or N is not a month
 * length — the grid is then not trusted for day positions.
 */
export const validateDayHeader = (values: (number | null)[]): DayHeader | null => {
  let best: DayHeader | null = null;

  for (let firstColumn = 0; firstColumn <= Math.min(MAX_FIRST_COLUMN, values.length - 1); firstColumn += 1) {
    let matchedDays = 0;
    let lastDay = 0;

    for (let day = 1; day <= MAX_DAYS_IN_MONTH && firstColumn + day - 1 < values.length; day += 1) {
      if (values[firstColumn + day - 1] === day) {
        matchedDays += 1;
        lastDay = day;
      }
    }

    if (lastDay < MIN_DAYS_IN_MONTH || matchedDays < lastDay * MIN_HEADER_MATCH_SHARE) {
      continue;
    }

    if (!best || matchedDays > best.matchedDays) {
      best = { firstColumn, dayCount: lastDay, matchedDays };
    }
  }

  return best;
};

/**
 * A day past the validated header still counts when its column read part of its number (`"3"` or `"37"`
 * for 31): OCR saw a day number there, just not exactly. An empty or unrelated reading does not.
 */
export const isPartialDayMatch = (text: string, day: number): boolean => {
  const digits = text.replace(/\D/gu, '');
  const target = String(day);

  if (digits.length === 0) {
    return false;
  }

  return (
    target.includes(digits) ||
    (digits.length === target.length && [...digits].some((digit, index) => digit === target[index]))
  );
};

/**
 * Days N of the table: the validated header count, extended toward the title month's length (capped by
 * the columns there) only while each further column partially reads its day number. Days not reached stay
 * unread (MISSING_DATE, 확인 필요) instead of trusting columns the header never confirmed.
 * `dayTexts[i]` is the header reading of day i + 1's column.
 */
export const extendDayCount = (headerDays: number, dayTexts: string[], targetDays: number): number => {
  let days = headerDays;

  while (days < targetDays && isPartialDayMatch(dayTexts[days] ?? '', days + 1)) {
    days += 1;
  }

  return days;
};

/** Weekday syllables of a Korean roster's second header row. */
export const KOREAN_WEEKDAYS = '일월화수목금토';

/** A weekday row reads a weekday syllable in at least this share of the sampled cells. */
const WEEKDAY_ROW_SHARE = 0.5;

/** True when most sampled cells of a row read a single weekday syllable. */
export const isWeekdayRow = (texts: string[]): boolean =>
  texts.length > 0 &&
  texts.filter((text) => {
    const compact = text.replace(/\s+/gu, '');

    return compact.length === 1 && KOREAN_WEEKDAYS.includes(compact);
  }).length >=
    texts.length * WEEKDAY_ROW_SHARE;

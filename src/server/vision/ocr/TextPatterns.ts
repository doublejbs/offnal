import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { formatYearMonth } from '@/domain/YearMonth';

/** Title pattern "2026 년 10 월" with the OCR's usual slips (stray quote, 녀/넌 for 년, 윌/뭘 for 월). */
const YEAR_MONTH_PATTERN = /(20\d{2})\s*[년넌녀]?\s*['"`’.,]?\s*(\d{1,2})\s*[월윌욀뭘]/u;
/** With 년 read, the next number is the month even when 월 is garbled ("2026 년 8 ： 근무표"). */
const YEAR_THEN_MONTH_PATTERN = /(20\d{2})\s*[년넌]\s*(\d{1,2})(?!\d)/u;
/**
 * Time range "07:00 ~ 16:00" (colon misread as ; or .). OCR drops either the start's colon or the tilde,
 * never both here: "1300~22:00" and "13:00 22:00" pass, "258 07:00" does not.
 */
const TIME_RANGE_PATTERN =
  /(?<!\d)(\d{1,2})\s*(?:[:;.：]\s*(\d{2})\s*[~∼〜\-–—]?|(\d{2})\s*[~∼〜\-–—])\s*(\d{1,2})\s*[:;.：]\s*(\d{2})(?!\d)/gu;
/** The legend separator "/" is often read as one of these in front of the code letter. */
const SLASH_LOOKALIKES = /^[/|\\[(IlT1]/u;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;

/** "YYYY-MM" from the sheet title, or null (the user then chooses the month). */
export const parseTitleYearMonth = (text: string): string | null => {
  const normalized = text.normalize('NFC');
  const match = YEAR_MONTH_PATTERN.exec(normalized) ?? YEAR_THEN_MONTH_PATTERN.exec(normalized);

  if (!match) {
    return null;
  }

  const month = Number(match[2]);

  return month >= 1 && month <= 12 ? formatYearMonth(Number(match[1]), month) : null;
};

const toTime = (hour: string, minute: string): string | null => {
  const hours = Number(hour);
  const minutes = Number(minute);

  if (hours > MAX_HOUR || minutes > MAX_MINUTE) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${minute}`;
};

/**
 * Code letter of the legend entry written just before a time range: the last word before it ("D근무",
 * or "D258" when English OCR reads 근무 as digits), with a misread leading slash ("/E근무" → "TEES") dropped.
 */
export const findLegendCode = (before: string): string | null => {
  const word = before.trim().split(/\s+/u).at(-1) ?? '';
  const unslashed = SLASH_LOOKALIKES.test(word) && /^[A-Z]/u.test(word.slice(1)) ? word.slice(1) : word;
  const cleaned = unslashed.replace(/^[/|\\[(]+/u, '');

  return /^[A-Z]/u.test(cleaned) ? cleaned[0]! : null;
};

/**
 * Shift definitions from the legend text below the table ("D근무 07:00 ~ 16:00 / E근무 …"). Each time range
 * takes the code letter right before it; entries without a letter or with impossible times are skipped.
 * An end before the start means the shift ends the next day. First entry per code wins.
 */
export const parseLegendDefinitions = (text: string): ShiftDefinition[] => {
  const definitions = new Map<string, ShiftDefinition>();
  const normalized = text.normalize('NFC');
  let previousEnd = 0;

  for (const match of normalized.matchAll(TIME_RANGE_PATTERN)) {
    const [, startHour, colonMinute, bareMinute, endHour, endMinute] = match;
    const startMinute = colonMinute ?? bareMinute;
    const lineStart = normalized.lastIndexOf('\n', match.index) + 1;
    const code = findLegendCode(normalized.slice(Math.max(previousEnd, lineStart), match.index));
    const startTime = toTime(startHour!, startMinute!);
    const endTime = toTime(endHour!, endMinute!);

    previousEnd = match.index + match[0].length;

    if (!code || !startTime || !endTime || definitions.has(code)) {
      continue;
    }

    definitions.set(code, {
      code,
      label: code,
      startTime,
      endTime,
      endsNextDay: endTime < startTime,
      isOff: false,
    });
  }

  return [...definitions.values()];
};

/** The literal OFF code as an off definition (Spec §16 exception). */
export const buildOffDefinition = (code: string): ShiftDefinition => ({
  code,
  label: code,
  startTime: null,
  endTime: null,
  endsNextDay: null,
  isOff: true,
});

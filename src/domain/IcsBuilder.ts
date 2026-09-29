import { createEvents, type DateArray, type EventAttributes } from 'ics';

import { toUtcRange } from '@/domain/ShiftTime';
import { SEOUL_TIMEZONE } from '@/domain/TimeZone';
import { type IcsBuildInput } from '@/domain/types/IcsBuildInput';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type DateParts } from '@/domain/types/DateParts';
import { formatYearMonthLabel, parseDate, shiftDateParts } from '@/domain/YearMonth';

const PRODUCT_ID = '-//Offnal//Offnal MVP//KO';
// The ics library always writes this header line; it implies a subscription refresh interval, which a one-time import is not.
const PUBLISHED_TTL_LINE = 'X-PUBLISHED-TTL:PT1H\r\n';
const TIMEZONE_LINE = `X-WR-TIMEZONE:${SEOUL_TIMEZONE}\r\n`;
const EVENT_DESCRIPTION = '오프날에서 가져온 일정 · 이후 변경은 자동 반영되지 않아요';

// `timestamp` (DTSTAMP) is supported by the ics schema but missing from its type definitions.
type EventWithTimestamp = EventAttributes & { timestamp: number };

const requireDateParts = (date: string): DateParts => {
  const parts = parseDate(date);

  if (!parts) {
    throw new Error(`Invalid date: ${date}`);
  }

  return parts;
};

const toDateArray = (parts: DateParts): DateArray => [parts.year, parts.month, parts.day];

/** RFC 5545 TEXT escaping; the ics library only escapes newlines in X-WR-CALNAME. */
const escapeIcsText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

/** Replaces the library's X-PUBLISHED-TTL header line with X-WR-TIMEZONE (header only, never inside events). */
const rewriteCalendarHeader = (ics: string): string => {
  const headerEnd = ics.indexOf('BEGIN:VEVENT');
  const splitAt = headerEnd === -1 ? ics.indexOf('END:VCALENDAR') : headerEnd;
  const header = ics.slice(0, splitAt);
  const rewritten = header.includes(PUBLISHED_TTL_LINE)
    ? header.replace(PUBLISHED_TTL_LINE, TIMEZONE_LINE)
    : `${header}${TIMEZONE_LINE}`;

  return `${rewritten}${ics.slice(splitAt)}`;
};

const toUtcDateTimeArray = (instant: Date): DateArray => [
  instant.getUTCFullYear(),
  instant.getUTCMonth() + 1,
  instant.getUTCDate(),
  instant.getUTCHours(),
  instant.getUTCMinutes(),
];

export const buildEventUid = (calendarId: string, date: string): string => `${calendarId}-${date}@offnal`;

const buildEvent = (
  input: IcsBuildInput,
  date: string,
  definition: ShiftDefinition,
): EventWithTimestamp | null => {
  const base = {
    uid: buildEventUid(input.calendarId, date),
    title: `${definition.label} (${definition.code})`,
    description: EVENT_DESCRIPTION,
    timestamp: input.generatedAt.getTime(),
    productId: PRODUCT_ID,
  };

  if (definition.isOff) {
    if (!input.includeOff) {
      return null;
    }

    return {
      ...base,
      start: toDateArray(requireDateParts(date)),
      end: toDateArray(shiftDateParts(requireDateParts(date), 1)),
      transp: 'TRANSPARENT',
      busyStatus: 'FREE',
    };
  }

  const range = toUtcRange(date, definition);

  return {
    ...base,
    start: toUtcDateTimeArray(range.start),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: toUtcDateTimeArray(range.end),
    endInputType: 'utc',
    endOutputType: 'utc',
    busyStatus: 'BUSY',
  };
};

export const buildIcs = (input: IcsBuildInput): string => {
  const definitionByCode = new Map(input.definitions.map((definition) => [definition.code, definition]));
  const events: EventWithTimestamp[] = [];
  const sortedEntries = [...input.entries].sort((left, right) => left.date.localeCompare(right.date));

  for (const entry of sortedEntries) {
    const definition = entry.code === null ? undefined : definitionByCode.get(entry.code);

    if (!definition) {
      continue;
    }

    const event = buildEvent(input, entry.date, definition);

    if (event) {
      events.push(event);
    }
  }

  const { error, value } = createEvents(events, {
    productId: PRODUCT_ID,
    method: 'PUBLISH',
    calName: escapeIcsText(`오프날 · ${input.displayName} ${formatYearMonthLabel(input.yearMonth)}`),
  });

  if (error || value === null) {
    throw new Error(`ICS generation failed: ${error?.message ?? 'unknown error'}`);
  }

  return rewriteCalendarHeader(value);
};

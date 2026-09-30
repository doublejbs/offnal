import { createEvents, type DateArray, type EventAttributes } from 'ics';

import { toUtcRange } from '@/domain/ShiftTime';
import { SEOUL_TIMEZONE } from '@/domain/TimeZone';
import { type DateParts } from '@/domain/types/DateParts';
import { type IcsBuildInput } from '@/domain/types/IcsBuildInput';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { formatYearMonthLabel, parseDate, shiftDateParts } from '@/domain/YearMonth';

const PRODUCT_ID = '-//Offnal//Offnal MVP//KO';
// The ics library always writes this header line; it implies a subscription refresh interval, which a one-time import is not.
const PUBLISHED_TTL_PREFIX = 'X-PUBLISHED-TTL:';
const TIMEZONE_LINE = `X-WR-TIMEZONE:${SEOUL_TIMEZONE}`;
const CRLF = '\r\n';
const HEADER_END_LINES = new Set(['BEGIN:VEVENT', 'END:VCALENDAR']);
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

/** Groups physical CRLF lines into logical content lines (RFC 5545 folding: continuations start with space/tab). */
const splitContentLines = (ics: string): string[][] => {
  const contentLines: string[][] = [];

  for (const line of ics.split(CRLF)) {
    const current = contentLines.at(-1);

    if (current && (line.startsWith(' ') || line.startsWith('\t'))) {
      current.push(line);
    } else {
      contentLines.push([line]);
    }
  }

  return contentLines;
};

/**
 * Replaces the library's X-PUBLISHED-TTL header line with X-WR-TIMEZONE. Works on whole content lines and
 * only looks before the first line that is exactly BEGIN:VEVENT (or END:VCALENDAR), so user text cannot move it.
 */
const rewriteCalendarHeader = (ics: string): string => {
  const contentLines = splitContentLines(ics);
  const headerEnd = contentLines.findIndex(
    (lines) => lines.length === 1 && HEADER_END_LINES.has(lines[0] ?? ''),
  );

  if (headerEnd === -1) {
    throw new Error('ICS generation failed: calendar header not found');
  }

  const ttlIndex = contentLines
    .slice(0, headerEnd)
    .findIndex((lines) => (lines[0] ?? '').startsWith(PUBLISHED_TTL_PREFIX));

  if (ttlIndex === -1) {
    contentLines.splice(headerEnd, 0, [TIMEZONE_LINE]);
  } else {
    contentLines.splice(ttlIndex, 1, [TIMEZONE_LINE]);
  }

  return contentLines.map((lines) => lines.join(CRLF)).join(CRLF);
};

const toUtcDateTimeArray = (instant: Date): DateArray => [
  instant.getUTCFullYear(),
  instant.getUTCMonth() + 1,
  instant.getUTCDate(),
  instant.getUTCHours(),
  instant.getUTCMinutes(),
];

/** `base` is the calendarId for the owner's file and a hash of it for a shared-view file. */
export const buildEventUid = (base: string, date: string): string => `${base}-${date}@offnal`;

const buildEvent = (
  input: IcsBuildInput,
  date: string,
  definition: ShiftDefinition,
): EventWithTimestamp | null => {
  const shiftTitle = `${definition.label} (${definition.code})`;
  const base = {
    uid: buildEventUid(input.uidBase ?? input.calendarId, date),
    title: input.titlePrefix === undefined ? shiftTitle : `${input.titlePrefix} · ${shiftTitle}`,
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
    calName: escapeIcsText(
      input.calendarName ?? `오프날 · ${input.displayName} ${formatYearMonthLabel(input.yearMonth)}`,
    ),
  });

  if (error || value === null) {
    throw new Error(`ICS generation failed: ${error?.message ?? 'unknown error'}`);
  }

  return rewriteCalendarHeader(value);
};

import { createEvents, type DateArray, type EventAttributes } from 'ics';

import { toUtcRange } from '@/domain/ShiftTime';
import { type IcsBuildInput } from '@/domain/types/IcsBuildInput';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { addDaysToDate, formatYearMonthLabel, parseDate } from '@/domain/YearMonth';

const PRODUCT_ID = 'offnal';
const EVENT_DESCRIPTION = '오프날에서 가져온 일정 · 이후 변경은 자동 반영되지 않아요';

// `timestamp` (DTSTAMP) is supported by the ics schema but missing from its type definitions.
type EventWithTimestamp = EventAttributes & { timestamp: number };

const toDateArray = (date: string): DateArray => {
  const parts = parseDate(date);

  if (!parts) {
    throw new Error(`Invalid date: ${date}`);
  }

  return [parts.year, parts.month, parts.day];
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
      start: toDateArray(date),
      end: toDateArray(addDaysToDate(date, 1)),
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
    calName: `오프날 · ${input.displayName} ${formatYearMonthLabel(input.yearMonth)}`,
  });

  if (error || value === null) {
    throw new Error(`ICS generation failed: ${error?.message ?? 'unknown error'}`);
  }

  return value;
};

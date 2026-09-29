import { type ZonedDateTimeParts } from '@/domain/types/ZonedDateTimeParts';

/** The only place that fixes the product timezone assumption. */
export const SEOUL_TIMEZONE = 'Asia/Seoul';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timezone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timezone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  formatterCache.set(timezone, formatter);

  return formatter;
};

export const getZonedParts = (instant: Date, timezone: string = SEOUL_TIMEZONE): ZonedDateTimeParts => {
  const values = new Map(
    getFormatter(timezone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(values.get(type));

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
};

const getOffsetMs = (instant: Date, timezone: string): number => {
  const parts = getZonedParts(instant, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;

  return asUtc - truncated;
};

/** Converts a wall-clock time in `timezone` to the corresponding UTC instant. */
export const zonedWallTimeToUtc = (
  wall: Omit<ZonedDateTimeParts, 'second'>,
  timezone: string = SEOUL_TIMEZONE,
): Date => {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstOffset = getOffsetMs(new Date(guess), timezone);
  const candidate = guess - firstOffset;
  const secondOffset = getOffsetMs(new Date(candidate), timezone);

  if (secondOffset === firstOffset) {
    return new Date(candidate);
  }

  return new Date(guess - secondOffset);
};

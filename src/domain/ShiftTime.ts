import { SEOUL_TIMEZONE, zonedWallTimeToUtc } from '@/domain/TimeZone';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type UtcRange } from '@/domain/types/UtcRange';
import { addDaysToDate, parseDate } from '@/domain/YearMonth';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ShiftTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiftTimeError';
  }
}

export const isValidTime = (value: string): boolean => TIME_PATTERN.test(value);

const parseTime = (value: string | null, field: string): { hour: number; minute: number } => {
  const match = value === null ? null : TIME_PATTERN.exec(value);

  if (!match) {
    throw new ShiftTimeError(`Invalid ${field}: ${String(value)}`);
  }

  return { hour: Number(match[1]), minute: Number(match[2]) };
};

const toMinutes = (time: { hour: number; minute: number }): number => time.hour * 60 + time.minute;

/** Whether a non-off definition has complete and consistent times. */
export const hasCompleteTimes = (definition: ShiftDefinition): boolean => {
  if (definition.isOff) {
    return true;
  }

  if (definition.endsNextDay === null || definition.startTime === null || definition.endTime === null) {
    return false;
  }

  if (!isValidTime(definition.startTime) || !isValidTime(definition.endTime)) {
    return false;
  }

  if (definition.endsNextDay) {
    return true;
  }

  return (
    toMinutes(parseTime(definition.endTime, 'endTime')) >
    toMinutes(parseTime(definition.startTime, 'startTime'))
  );
};

export const toUtcRange = (
  date: string,
  definition: ShiftDefinition,
  timezone: string = SEOUL_TIMEZONE,
): UtcRange => {
  if (definition.isOff) {
    throw new ShiftTimeError(`Off definition has no time range: ${definition.code}`);
  }

  const startDate = parseDate(date);

  if (!startDate) {
    throw new ShiftTimeError(`Invalid date: ${date}`);
  }

  if (definition.endsNextDay === null) {
    throw new ShiftTimeError(`endsNextDay is not set: ${definition.code}`);
  }

  const startTime = parseTime(definition.startTime, 'startTime');
  const endTime = parseTime(definition.endTime, 'endTime');

  if (!definition.endsNextDay && toMinutes(endTime) <= toMinutes(startTime)) {
    throw new ShiftTimeError(`End must be after start on the same day: ${definition.code}`);
  }

  const endDate = parseDate(definition.endsNextDay ? addDaysToDate(date, 1) : date);

  if (!endDate) {
    throw new ShiftTimeError(`Invalid end date for: ${date}`);
  }

  const start = zonedWallTimeToUtc({ ...startDate, ...startTime }, timezone);
  const end = zonedWallTimeToUtc({ ...endDate, ...endTime }, timezone);

  return { start, end };
};

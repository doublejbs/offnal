import { SEOUL_TIMEZONE, zonedWallTimeToUtc } from '@/domain/TimeZone';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type TimeOfDay } from '@/domain/types/TimeOfDay';
import { type UtcRange } from '@/domain/types/UtcRange';
import { parseDate, shiftDateParts } from '@/domain/YearMonth';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ShiftTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiftTimeError';
  }
}

export const isValidTime = (value: string): boolean => TIME_PATTERN.test(value);

const parseTime = (value: string | null, field: string): TimeOfDay => {
  const match = value === null ? null : TIME_PATTERN.exec(value);

  if (!match) {
    throw new ShiftTimeError(`Invalid ${field}: ${String(value)}`);
  }

  return { hour: Number(match[1]), minute: Number(match[2]) };
};

const toMinutes = (time: TimeOfDay): number => time.hour * 60 + time.minute;

/** Same-day shifts must end after they start; overnight shifts may last at most 24 hours. */
const isValidTimeOrder = (startTime: TimeOfDay, endTime: TimeOfDay, endsNextDay: boolean): boolean => {
  if (endsNextDay) {
    return toMinutes(endTime) <= toMinutes(startTime);
  }

  return toMinutes(endTime) > toMinutes(startTime);
};

/** Whether a non-off definition has complete and consistent times. */
export const hasCompleteTimes = (definition: ShiftDefinition): boolean => {
  if (definition.isOff) {
    return true;
  }

  const { startTime, endTime, endsNextDay } = definition;

  if (endsNextDay === null || startTime === null || endTime === null) {
    return false;
  }

  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return false;
  }

  return isValidTimeOrder(parseTime(startTime, 'startTime'), parseTime(endTime, 'endTime'), endsNextDay);
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

  if (!isValidTimeOrder(startTime, endTime, definition.endsNextDay)) {
    throw new ShiftTimeError(`Invalid shift time order: ${definition.code}`);
  }

  // Only the input date is range-checked; the computed end date may be 2101-01-01.
  const endDate = definition.endsNextDay ? shiftDateParts(startDate, 1) : startDate;
  const start = zonedWallTimeToUtc({ ...startDate, ...startTime }, timezone);
  const end = zonedWallTimeToUtc({ ...endDate, ...endTime }, timezone);

  return { start, end };
};

import { describe, expect, it } from 'vitest';

import { hasCompleteTimes, isValidTime, toUtcRange } from '@/domain/ShiftTime';
import { SEOUL_TIMEZONE } from '@/domain/TimeZone';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

const DAY: ShiftDefinition = {
  code: 'D',
  label: '데이',
  startTime: '07:00',
  endTime: '16:00',
  endsNextDay: false,
  isOff: false,
};
const NIGHT: ShiftDefinition = {
  code: 'N',
  label: '나이트',
  startTime: '22:00',
  endTime: '07:00',
  endsNextDay: true,
  isOff: false,
};

describe('ShiftTime.toUtcRange', () => {
  it('uses Asia/Seoul by default', () => {
    expect(toUtcRange('2026-11-01', NIGHT)).toEqual(toUtcRange('2026-11-01', NIGHT, 'Asia/Seoul'));
    expect(toUtcRange('2026-11-01', NIGHT)).toEqual(toUtcRange('2026-11-01', NIGHT, SEOUL_TIMEZONE));
  });

  it('converts KST 07:00 to previous day 22:00Z', () => {
    const range = toUtcRange('2026-11-01', DAY);

    expect(range.start.toISOString()).toBe('2026-10-31T22:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });

  it('ends night shift on 10/31 on 11/01', () => {
    const range = toUtcRange('2026-10-31', NIGHT);

    expect(range.start.toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-31T22:00:00.000Z');
  });

  it('ends night shift on 12/31 on 01/01 of next year', () => {
    const range = toUtcRange('2026-12-31', { ...NIGHT, endTime: '09:00' });

    expect(range.start.toISOString()).toBe('2026-12-31T13:00:00.000Z');
    expect(range.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('handles leap day boundaries', () => {
    const feb28 = toUtcRange('2028-02-28', { ...NIGHT, endTime: '10:00' });
    const feb29 = toUtcRange('2028-02-29', { ...NIGHT, endTime: '10:00' });

    expect(feb28.end.toISOString()).toBe('2028-02-29T01:00:00.000Z');
    expect(feb29.end.toISOString()).toBe('2028-03-01T01:00:00.000Z');
  });

  it('ends the 2100-12-31 night shift on 2101-01-01 without throwing', () => {
    const range = toUtcRange('2100-12-31', { ...NIGHT, endTime: '09:00' });

    expect(range.start.toISOString()).toBe('2100-12-31T13:00:00.000Z');
    expect(range.end.toISOString()).toBe('2101-01-01T00:00:00.000Z');
  });

  it('allows an exact 24-hour overnight shift but rejects longer ones', () => {
    const exact = toUtcRange('2026-11-01', { ...NIGHT, startTime: '09:00', endTime: '09:00' });

    expect(exact.end.getTime() - exact.start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(() => toUtcRange('2026-11-01', { ...NIGHT, startTime: '09:00', endTime: '18:00' })).toThrow();
    expect(hasCompleteTimes({ ...NIGHT, startTime: '09:00', endTime: '18:00' })).toBe(false);
    expect(hasCompleteTimes(NIGHT)).toBe(true);
  });

  it('supports other timezones', () => {
    const range = toUtcRange('2026-07-01', DAY, 'America/New_York');

    expect(range.start.toISOString()).toBe('2026-07-01T11:00:00.000Z');
  });

  it('throws when end is not after start on the same day', () => {
    expect(() => toUtcRange('2026-11-01', { ...DAY, endTime: '07:00' })).toThrow();
    expect(() => toUtcRange('2026-11-01', { ...DAY, endTime: '06:00' })).toThrow();
  });

  it('throws for off or incomplete definitions', () => {
    expect(() =>
      toUtcRange('2026-11-01', { ...DAY, isOff: true, startTime: null, endTime: null, endsNextDay: null }),
    ).toThrow();
    expect(() => toUtcRange('2026-11-01', { ...DAY, startTime: null })).toThrow();
    expect(() => toUtcRange('2026-11-01', { ...DAY, endsNextDay: null })).toThrow();
    expect(() => toUtcRange('2026-11-31', DAY)).toThrow();
  });

  it('validates HH:mm', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:00')).toBe(false);
    expect(isValidTime('07:60')).toBe(false);
  });
});

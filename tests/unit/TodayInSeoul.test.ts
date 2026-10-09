import { describe, expect, it } from 'vitest';

import { msUntilNextSeoulMidnight, todayInSeoul } from '@/domain/YearMonth';

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

describe('today in Seoul (§25)', () => {
  it('flips to the next date exactly at Seoul midnight (15:00 UTC)', () => {
    expect(todayInSeoul(new Date('2026-10-09T14:59:59Z'))).toBe('2026-10-09');
    expect(todayInSeoul(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-10');
  });

  it('crosses month and year boundaries', () => {
    expect(todayInSeoul(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01');
    expect(todayInSeoul(new Date('2026-12-31T14:59:59Z'))).toBe('2026-12-31');
    expect(todayInSeoul(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });

  it('measures the time left until the next Seoul midnight', () => {
    expect(msUntilNextSeoulMidnight(new Date('2026-10-09T14:59:59Z'))).toBe(SECOND_MS);
    expect(msUntilNextSeoulMidnight(new Date('2026-10-09T15:00:00Z'))).toBe(24 * HOUR_MS);
    expect(msUntilNextSeoulMidnight(new Date('2026-10-09T03:00:00Z'))).toBe(12 * HOUR_MS);
    expect(msUntilNextSeoulMidnight(new Date('2026-12-31T14:59:59.250Z'))).toBe(750);
  });

  it('lands on a moment whose Seoul date is the next day', () => {
    const now = new Date('2026-10-09T05:12:34.567Z');
    const midnight = new Date(now.getTime() + msUntilNextSeoulMidnight(now));

    expect(todayInSeoul(new Date(midnight.getTime() - 1))).toBe('2026-10-09');
    expect(todayInSeoul(midnight)).toBe('2026-10-10');
  });
});

import { describe, expect, it } from 'vitest';

import { pickLandingMonth } from '@/domain/CalendarLanding';

describe('CalendarLanding', () => {
  it('returns current month if it is in the published months', () => {
    const months = ['2025-10', '2025-11', '2025-12'];
    const now = new Date('2025-11-15T12:00:00Z');

    // Mock currentYearMonthInSeoul to return 2025-11 for this test
    const result = pickLandingMonth(months, now);

    expect(result).toBe('2025-11');
  });

  it('returns the latest published month if current month is not published', () => {
    const months = ['2025-10', '2025-11'];
    const now = new Date('2025-12-15T12:00:00Z');

    const result = pickLandingMonth(months, now);

    expect(result).toBe('2025-11');
  });

  it('returns null if no months are published', () => {
    const months: string[] = [];
    const now = new Date('2025-12-15T12:00:00Z');

    const result = pickLandingMonth(months, now);

    expect(result).toBeNull();
  });

  it('handles single month in the list', () => {
    const months = ['2025-10'];
    const now = new Date('2025-10-15T12:00:00Z');

    const result = pickLandingMonth(months, now);

    expect(result).toBe('2025-10');
  });
});

import { currentYearMonthInSeoul } from '@/domain/YearMonth';

/**
 * Picks the landing month for a user: if the current Seoul month is published,
 * use it; otherwise use the latest published month; if no months exist, return null.
 */
export const pickLandingMonth = (months: string[], now: Date): string | null => {
  const current = currentYearMonthInSeoul(now);
  const target = months.includes(current) ? current : months.at(-1);

  return target ?? null;
};

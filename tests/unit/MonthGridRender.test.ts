import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MonthGrid from '@/components/calendar/MonthGrid';

import { buildEntries, DEFINITIONS, YEAR_MONTH } from './support/RosterUiFixture';

/** Server renders of the shared month grid (§25 today mark); `today` is injected since the hook is null on the server. */

const TODAY = '2026-11-09';

const countMatches = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;

const renderGrid = (props: Partial<Parameters<typeof MonthGrid>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(MonthGrid, {
      yearMonth: YEAR_MONTH,
      entries: buildEntries('D'),
      definitions: DEFINITIONS,
      selectedDate: null,
      ...props,
    }),
  );

describe('MonthGrid today mark', () => {
  it('marks only today in the interactive grid, alongside the selected outline', () => {
    const html = renderGrid({ today: TODAY, selectedDate: TODAY, onSelectDate: () => undefined });

    expect(countMatches(html, /class="today-mark"/g)).toBe(1);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*aria-label="오늘, 11월 9일 D"/);
    // The "오늘, " prefix is the only announcement; aria-current would say it twice.
    expect(html).not.toContain('aria-current');
    expect(html).toContain('<span class="today-mark">9</span>');
    expect(html).toContain('aria-label="11월 10일 D"');
    expect(countMatches(html, /오늘, /g)).toBe(1);
  });

  it('marks today in the static preview too', () => {
    const html = renderGrid({ today: TODAY });

    expect(html).not.toContain('<button');
    expect(html).toMatch(/<div class="day" role="img" aria-label="오늘, 11월 9일 D">/);
    expect(countMatches(html, /class="today-mark"/g)).toBe(1);
  });

  it('shows nothing when the viewed month does not contain today', () => {
    const html = renderGrid({ today: '2026-12-09', onSelectDate: () => undefined });

    expect(html).not.toContain('today-mark');
    expect(html).not.toContain('오늘, ');
  });

  it('shows nothing with showToday={false} (PNG export preview)', () => {
    const html = renderGrid({ today: TODAY, showToday: false });

    expect(html).not.toContain('today-mark');
    expect(html).not.toContain('오늘, ');
  });

  it('renders no mark on the server without an injected today (hydration-safe)', () => {
    const html = renderGrid({ onSelectDate: () => undefined });

    expect(html).not.toContain('today-mark');
    expect(html).not.toContain('오늘, ');
  });
});

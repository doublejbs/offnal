import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RosterGridView from '@/components/roster/RosterGridView';
import RosterPersonListView from '@/components/roster/RosterPersonListView';
import RosterProgressView from '@/components/roster/RosterProgressView';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { listDates } from '@/domain/YearMonth';

import { buildEntries, buildProgress, buildRow, DEFINITIONS, YEAR_MONTH } from './support/RosterUiFixture';

/**
 * Smoke renders of the admin roster views with react-dom/server (no DOM library is installed, so no
 * interaction here — that is covered by e2e/TeamShare.spec.ts).
 */

const noop = () => undefined;

const review = {
  date: '2026-11-05',
  code: 'E',
  reviewReasons: [ShiftReviewReason.AMBIGUOUS],
  confirmed: false,
};

const rows = [
  buildRow('r1', '김하루', { entries: buildEntries('D', { 5: review }), reviewCount: 1 }),
  buildRow('r2', '김하루', { sameNameOrdinal: 2, sameNameCount: 2, entries: buildEntries('N') }),
  buildRow('r3', '-', { excluded: true }),
  buildRow('r4', '박새벽', {
    extractStatus: RosterRowExtractStatus.FAILED,
    entries: buildEntries(null),
    reviewCount: 30,
  }),
];

const countMatches = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;

describe('roster views (smoke render)', () => {
  it('review table: one tab stop, labelled cells, same-name ordinal, excluded rows', () => {
    const dates = listDates(YEAR_MONTH);
    const html = renderToStaticMarkup(
      createElement(RosterGridView, {
        rows,
        dates,
        definitions: DEFINITIONS,
        selected: { rowId: 'r1', date: '2026-11-05' },
        onSelect: noop,
      }),
    );

    expect(countMatches(html, /tabindex="0"/g)).toBe(1);
    expect(countMatches(html, /class="roster-cell"/g)).toBe(rows.length * dates.length);
    expect(html).toContain('aria-label="김하루 11월 5일 E 확인 필요"');
    expect(html).toContain('김하루 (2)');
    expect(html).toContain('aria-label="- 11월 1일 제외된 행"');
    expect(html).toMatch(/<button[^>]*tabindex="0"[^>]*aria-pressed="true"[^>]*aria-label="김하루 11월 5일/);
  });

  it('progress: real counts in a live region and the failed rows with retry', () => {
    const html = renderToStaticMarkup(
      createElement(RosterProgressView, {
        teamHref: '/teams/t',
        progress: buildProgress({
          phase: TeamRosterPhase.EXTRACTING,
          total: 18,
          done: 11,
          manual: 1,
          pending: 6,
        }),
        failedRows: [
          { rowId: 'f', displayName: '박새벽', attemptCount: 1, errorCode: null, retryable: true },
        ],
        isRunning: false,
        error: null,
        onStart: noop,
      }),
    );

    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(html).toContain('12/18명 읽는 중');
    expect(html).toContain('읽지 못한 사람 1명');
    expect(html).toContain('1명 다시 시도');
    expect(html).toContain('이어서 읽기');
  });

  it('mobile person list: review status per person', () => {
    const html = renderToStaticMarkup(createElement(RosterPersonListView, { rows, onOpen: noop }));

    expect(html).toContain('확인 필요 1칸');
    expect(html).toContain('확인 완료');
    expect(html).toContain('제외됨');
    expect(html).toContain('읽지 못했어요');
  });
});

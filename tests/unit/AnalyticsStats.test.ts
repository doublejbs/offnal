import { describe, expect, it } from 'vitest';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import {
  type AnalyticsReportData,
  buildFunnel,
  formatAnalyticsReport,
  formatRate,
  pivotDailyCounts,
  toRate,
} from '@/server/analytics/AnalyticsStats';

const EMPTY_REPORT: AnalyticsReportData = {
  days: 30,
  funnel: { uploaded: 0, recognized: 0, claimed: 0, drafted: 0, published: 0 },
  team: { uploaded: 0, recognized: 0 },
  quality: {
    drafts: 0,
    reviewCells: { p50: null, p95: null },
    reviews: 0,
    editedCells: { p50: null, p95: null },
    fullMonthMatches: 0,
  },
  secondMonth: { publishers: 0, repeatPublishers: 0 },
  share: { sharers: 0, sharedViewDays: 0, sharedLinks: 0 },
  activity: { dailyActive: [], weeklyActive: 0 },
  retention: { eligible: 0, retained: 0 },
  daily: [],
};

describe('analytics stats', () => {
  it('computes safe rates', () => {
    expect(toRate(1, 4)).toBe(0.25);
    expect(toRate(0, 0)).toBeNull();
    expect(formatRate(0.25)).toBe('25.0%');
    expect(formatRate(null)).toBe('—');
  });

  it('builds the personal funnel with step and overall conversion', () => {
    const steps = buildFunnel({ uploaded: 10, recognized: 8, claimed: 6, drafted: 5, published: 4 });

    expect(steps.map((step) => step.count)).toEqual([10, 8, 6, 5, 4]);
    expect(steps[0]).toMatchObject({ fromPrevious: null, fromStart: 1 });
    expect(steps[1]).toMatchObject({ fromPrevious: 0.8, fromStart: 0.8 });
    expect(steps[4]).toMatchObject({ fromPrevious: 0.8, fromStart: 0.4 });
    expect(buildFunnel(EMPTY_REPORT.funnel).every((step) => step.fromStart === null)).toBe(true);
  });

  it('pivots daily counts into dates × events with zeros filled', () => {
    const pivot = pivotDailyCounts([
      { date: '2026-10-02', event: AnalyticsEvent.UPLOAD_STARTED, count: 3 },
      { date: '2026-10-01', event: AnalyticsEvent.UPLOAD_STARTED, count: 1 },
      { date: '2026-10-02', event: AnalyticsEvent.MONTH_PUBLISHED, count: 2 },
    ]);

    expect(pivot.dates).toEqual(['2026-10-01', '2026-10-02']);
    expect(pivot.events).toEqual([AnalyticsEvent.UPLOAD_STARTED, AnalyticsEvent.MONTH_PUBLISHED]);
    expect(pivot.counts).toEqual([
      [1, 0],
      [3, 2],
    ]);
  });

  it('formats an empty report without failing', () => {
    const text = formatAnalyticsReport(EMPTY_REPORT);

    expect(text).toContain('최근 30일');
    expect(text).toContain('이벤트 없음');
  });

  it('formats the §23.5 metrics in Korean', () => {
    const text = formatAnalyticsReport({
      ...EMPTY_REPORT,
      days: 7,
      funnel: { uploaded: 10, recognized: 8, claimed: 6, drafted: 5, published: 4 },
      quality: {
        drafts: 5,
        reviewCells: { p50: 2, p95: 6 },
        reviews: 4,
        editedCells: { p50: 1, p95: 3 },
        fullMonthMatches: 1,
      },
      secondMonth: { publishers: 4, repeatPublishers: 1 },
      share: { sharers: 2, sharedViewDays: 9, sharedLinks: 3 },
      team: { uploaded: 2, recognized: 1 },
      activity: { dailyActive: [{ date: '2026-10-01', users: 3 }], weeklyActive: 5 },
      retention: { eligible: 4, retained: 2 },
      daily: [{ date: '2026-10-01', event: AnalyticsEvent.UPLOAD_STARTED, count: 10 }],
    });

    expect(text).toContain('최근 7일');
    expect(text).toContain('업로드');
    expect(text).toContain('업로드 코호트');
    expect(text).toContain('팀 근무표 업로드: 2건');
    expect(text).toContain('링크·일 기준');
    expect(text).toContain('40.0%');
    expect(text).toContain('월 전체 일치율');
    expect(text).toContain('25.0%');
    expect(text).toContain('두 번째 달 등록률');
    expect(text).toContain('공유 링크당 열람');
    expect(text).toContain('3.0');
    expect(text).toContain('7일 재방문율');
    expect(text).toContain('50.0%');
    expect(text).toContain('upload_started');
  });
});

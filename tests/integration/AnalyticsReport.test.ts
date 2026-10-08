import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { collectAnalyticsReport } from '@/server/analytics/AnalyticsReportQueries';
import { formatAnalyticsReport } from '@/server/analytics/AnalyticsStats';
import { analyticsEvents } from '@/server/db/Schema';

import { type IntegrationEnvironment, setupIntegrationEnvironment } from '../helpers/ApiTestClient';

const NOW = new Date('2026-10-08T03:00:00Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * MS_PER_DAY);

type Insert = typeof analyticsEvents.$inferInsert;

const row = (
  event: AnalyticsEvent,
  at: Date,
  keys: { actor?: string; subject?: string } = {},
  properties: Insert['properties'] = {},
): Insert => ({
  event,
  actorKey: keys.actor ?? null,
  subjectKey: keys.subject ?? null,
  properties,
  createdAt: at,
});

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();

  const actorA = 'a'.repeat(32);
  const actorB = 'b'.repeat(32);
  const job1 = '1'.repeat(32);
  const job2 = '2'.repeat(32);
  const calendar = 'c'.repeat(32);

  await env.db.insert(analyticsEvents).values([
    // Old event outside the 30-day window.
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(40), { subject: '9'.repeat(32) }),
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(20), { subject: job1 }),
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(20), { subject: job2 }),
    row(AnalyticsEvent.RECOGNITION_COMPLETED, daysAgo(20), { subject: job1 }, { success: true, attempt: 1 }),
    row(AnalyticsEvent.RECOGNITION_COMPLETED, daysAgo(20), { subject: job2 }, { success: false, attempt: 1 }),
    row(AnalyticsEvent.JOB_CLAIMED, daysAgo(20), { actor: actorA, subject: job1 }),
    row(
      AnalyticsEvent.DRAFT_CREATED,
      daysAgo(20),
      { actor: actorA, subject: job1 },
      { dayCount: 31, reviewCells: 4, unresolvedCells: 2, ms: 900, manual: false },
    ),
    row(
      AnalyticsEvent.DRAFT_CREATED,
      daysAgo(19),
      { actor: actorB, subject: job2 },
      { dayCount: 31, reviewCells: 31, unresolvedCells: 31, ms: 10, manual: true },
    ),
    row(
      AnalyticsEvent.REVIEW_COMPLETED,
      daysAgo(20),
      { actor: actorA, subject: job1 },
      { editedCells: 0, initialReviewCells: 4, fullMonthMatch: true },
    ),
    row(
      AnalyticsEvent.MONTH_PUBLISHED,
      daysAgo(20),
      { actor: actorA, subject: job1 },
      { revision: 1, monthIndex: 1, usedTrial: true, beta: false },
    ),
    row(
      AnalyticsEvent.MONTH_PUBLISHED,
      daysAgo(10),
      { actor: actorA },
      { revision: 1, monthIndex: 2, usedTrial: true, beta: false },
    ),
    row(AnalyticsEvent.MONTH_PUBLISHED, daysAgo(3), { actor: actorB }, { revision: 1, monthIndex: 1 }),
    // A returns on a later day within 7 days of the first publish.
    row(AnalyticsEvent.CALENDAR_VIEWED, new Date(daysAgo(20).getTime() + 60_000), { actor: actorA }),
    row(AnalyticsEvent.CALENDAR_VIEWED, daysAgo(17), { actor: actorA }),
    row(AnalyticsEvent.CALENDAR_VIEWED, daysAgo(1), { actor: actorB }),
    row(AnalyticsEvent.EXPORT_LINK, daysAgo(9), { actor: actorA }, { visibleMonthCount: 1 }),
    row(AnalyticsEvent.EXPORT_LINK, daysAgo(8), { actor: actorB }, { visibleMonthCount: 2 }),
    row(AnalyticsEvent.EXPORT_LINK, daysAgo(7), { actor: actorB }, { visibleMonthCount: 0 }),
    row(AnalyticsEvent.SHARED_CALENDAR_VIEWED, daysAgo(6), { subject: calendar }),
    row(AnalyticsEvent.SHARED_CALENDAR_VIEWED, daysAgo(5), { subject: calendar }),
  ]);
});

afterAll(async () => {
  await env.close();
});

describe('collectAnalyticsReport', () => {
  it('computes the §23.5 metrics in SQL', async () => {
    const report = await collectAnalyticsReport(env.db, { days: 30, now: NOW });

    expect(report.funnel).toEqual({ uploaded: 2, recognized: 1, claimed: 1, drafted: 2, published: 1 });
    expect(report.quality).toEqual({
      drafts: 1,
      reviewCells: { p50: 4, p95: 4 },
      reviews: 1,
      editedCells: { p50: 0, p95: 0 },
      fullMonthMatches: 1,
    });
    expect(report.secondMonth).toEqual({ publishers: 2, repeatPublishers: 1 });
    expect(report.share).toEqual({ sharers: 1, sharedViews: 2, sharedLinks: 1 });
    expect(report.activity.weeklyActive).toBe(1);
    expect(report.activity.dailyActive.length).toBeGreaterThan(0);
    // B published 3 days ago: not yet eligible. A came back 3 days after the first publish.
    expect(report.retention).toEqual({ eligible: 1, retained: 1 });
    expect(report.daily.find((item) => item.event === AnalyticsEvent.UPLOAD_STARTED)?.count).toBe(2);
    expect(formatAnalyticsReport(report)).toContain('월 전체 일치율: 100.0%');
  });

  it('returns an empty report for an empty window', async () => {
    const report = await collectAnalyticsReport(env.db, { days: 1, now: daysAgo(100) });

    expect(report.funnel).toEqual({ uploaded: 0, recognized: 0, claimed: 0, drafted: 0, published: 0 });
    expect(report.quality.reviewCells).toEqual({ p50: null, p95: null });
    expect(report.retention).toEqual({ eligible: 0, retained: 0 });
    expect(formatAnalyticsReport(report)).toContain('이벤트 없음');
  });
});

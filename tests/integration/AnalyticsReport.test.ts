import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { LoginClickSource } from '@/domain/enums/LoginClickSource';
import { LoginFailureKind } from '@/domain/enums/LoginFailureKind';
import { ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';
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
  const actorC = 'd'.repeat(32);
  const calendar = 'c'.repeat(32);

  const job3 = '3'.repeat(32);
  const teamJob = '4'.repeat(32);
  const oldJob = '9'.repeat(32);

  await env.db.insert(analyticsEvents).values([
    // Uploaded before the window: its later steps inside the window are not part of this cohort.
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(40), { subject: oldJob }, { team: false }),
    row(AnalyticsEvent.JOB_CLAIMED, daysAgo(20), { actor: actorB, subject: oldJob }, { atUpload: false }),
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(20), { subject: job1 }, { team: false }),
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(20), { subject: job2 }, { team: false }),
    row(
      AnalyticsEvent.RECOGNITION_COMPLETED,
      daysAgo(20),
      { subject: job1 },
      { success: true, attempt: 1, team: false },
    ),
    row(
      AnalyticsEvent.RECOGNITION_COMPLETED,
      daysAgo(20),
      { subject: job2 },
      { success: false, attempt: 1, team: false },
    ),
    row(AnalyticsEvent.JOB_CLAIMED, daysAgo(20), { actor: actorA, subject: job1 }, { atUpload: false }),
    // Logged-in upload: claimed at upload time.
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(2), { subject: job3 }, { team: false }),
    row(AnalyticsEvent.JOB_CLAIMED, daysAgo(2), { actor: actorB, subject: job3 }, { atUpload: true }),
    // Team roster upload: outside the personal funnel.
    row(AnalyticsEvent.UPLOAD_STARTED, daysAgo(5), { subject: teamJob }, { team: true }),
    row(
      AnalyticsEvent.RECOGNITION_COMPLETED,
      daysAgo(5),
      { subject: teamJob },
      { success: true, team: true },
    ),
    row(
      AnalyticsEvent.DRAFT_CREATED,
      daysAgo(20),
      { actor: actorA, subject: job1 },
      { dayCount: 31, reviewCells: 4, unresolvedCells: 2, ms: 900, manual: false },
    ),
    row(
      AnalyticsEvent.DRAFT_CREATED,
      daysAgo(1),
      { actor: actorB, subject: job3 },
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
    // Not initiated by C (approved by an admin, paid via webhook): C is not an active user.
    row(AnalyticsEvent.TEAM_MEMBER_JOINED, daysAgo(1), { actor: actorC }, { memberCount: 2 }),
    row(AnalyticsEvent.PAYMENT_SUCCEEDED, daysAgo(1), { actor: actorC }, { amount: 1000, granted: true }),
    row(AnalyticsEvent.EXPORT_LINK, daysAgo(9), { actor: actorA }, { visibleMonthCount: 1 }),
    row(AnalyticsEvent.EXPORT_LINK, daysAgo(8), { actor: actorB }, { visibleMonthCount: 2 }),
    row(AnalyticsEvent.EXPORT_LINK, daysAgo(7), { actor: actorB }, { visibleMonthCount: 0 }),
    // Month switches on one day count once per link and day.
    row(AnalyticsEvent.SHARED_CALENDAR_VIEWED, daysAgo(6), { subject: calendar }),
    row(AnalyticsEvent.SHARED_CALENDAR_VIEWED, new Date(daysAgo(6).getTime() + 60_000), {
      subject: calendar,
    }),
    row(AnalyticsEvent.SHARED_CALENDAR_VIEWED, daysAgo(5), { subject: calendar }),
  ]);
});

afterAll(async () => {
  await env.close();
});

describe('collectAnalyticsReport', () => {
  it('computes the §23.5 metrics in SQL', async () => {
    const report = await collectAnalyticsReport(env.db, { days: 30, now: NOW });

    // Cohort: personal jobs uploaded in the window (job1, job2, job3); later steps of those jobs only.
    // Later stages only for recognized jobs: job3 (logged-in upload, never recognized) stops at upload.
    expect(report.funnel).toEqual({ uploaded: 3, recognized: 1, claimed: 1, drafted: 1, published: 1 });
    expect(report.team).toEqual({ uploaded: 1, recognized: 1 });
    expect(report.quality).toEqual({
      drafts: 1,
      reviewCells: { p50: 4, p95: 4 },
      reviews: 1,
      editedCells: { p50: 0, p95: 0 },
      fullMonthMatches: 1,
    });
    expect(report.secondMonth).toEqual({ publishers: 2, repeatPublishers: 1 });
    expect(report.share).toEqual({ sharers: 1, sharedViewDays: 2, sharedLinks: 1 });
    expect(report.activity.weeklyActive).toBe(1);
    expect(report.activity.dailyActive.at(-1)).toEqual({ date: '2026-10-07', users: 1 });
    // B published 3 days ago: not yet eligible. A came back 3 days after the first publish.
    expect(report.retention).toEqual({ eligible: 1, retained: 1 });
    expect(
      report.daily.find((item) => item.event === AnalyticsEvent.UPLOAD_STARTED && item.date === '2026-09-18')
        ?.count,
    ).toBe(2);
    expect(formatAnalyticsReport(report)).toContain('월 전체 일치율: 100.0%');
  });

  it('returns an empty report for an empty window', async () => {
    const report = await collectAnalyticsReport(env.db, { days: 1, now: daysAgo(100) });

    expect(report.funnel).toEqual({ uploaded: 0, recognized: 0, claimed: 0, drafted: 0, published: 0 });
    expect(report.team).toEqual({ uploaded: 0, recognized: 0 });
    expect(report.quality.reviewCells).toEqual({ p50: null, p95: null });
    expect(report.retention).toEqual({ eligible: 0, retained: 0 });
    expect(formatAnalyticsReport(report)).toContain('이벤트 없음');
  });

  it('computes the §26.5 entry-screen funnel with the inApp split', async () => {
    // A window far from the rows above, so only these events count.
    const later = new Date(NOW.getTime() + 400 * MS_PER_DAY);
    const at = new Date(later.getTime() - MS_PER_DAY);
    const inApp = { inApp: true };
    const regular = { inApp: false };

    await env.db.insert(analyticsEvents).values([
      row(AnalyticsEvent.LANDING_UPLOAD_CLICKED, at, {}, inApp),
      row(AnalyticsEvent.LANDING_UPLOAD_CLICKED, at, {}, inApp),
      row(AnalyticsEvent.LANDING_UPLOAD_CLICKED, at, {}, regular),
      // Recorded before inApp existed: counted in the total only.
      row(AnalyticsEvent.LANDING_UPLOAD_CLICKED, at, {}),
      row(AnalyticsEvent.UPLOAD_STARTED, at, { subject: '5'.repeat(32) }, { team: false, inApp: true }),
      row(AnalyticsEvent.UPLOAD_STARTED, at, { subject: '6'.repeat(32) }, { team: false, inApp: false }),
      row(AnalyticsEvent.UPLOAD_STARTED, at, { subject: '7'.repeat(32) }, { team: true, inApp: false }),
      row(AnalyticsEvent.SAMPLE_STARTED, at, {}, inApp),
      row(AnalyticsEvent.SAMPLE_STARTED, at, {}, regular),
      row(AnalyticsEvent.SAMPLE_COMPLETED, at, {}, inApp),
      row(AnalyticsEvent.SAMPLE_CTA_CLICKED, at, {}, inApp),
      row(AnalyticsEvent.SHARE_LATER_CLICKED, at, {}, { method: ShareLaterMethod.SHARE, inApp: true }),
      row(AnalyticsEvent.SHARE_LATER_CLICKED, at, {}, { method: ShareLaterMethod.COPY, inApp: false }),
      row(AnalyticsEvent.LOGIN_CLICKED, at, {}, { from: LoginClickSource.LANDING, inApp: true }),
      row(AnalyticsEvent.LOGIN_CLICKED, at, {}, { from: LoginClickSource.GATE, inApp: true }),
      row(AnalyticsEvent.LOGIN_CLICKED, at, {}, { from: LoginClickSource.GATE, inApp: false }),
      row(AnalyticsEvent.LOGIN_COMPLETED, at, { actor: 'e'.repeat(32) }, { firstLogin: true, inApp: false }),
      row(AnalyticsEvent.LOGIN_FAILED, at, {}, { kind: LoginFailureKind.CANCELLED, inApp: true }),
    ]);

    const report = await collectAnalyticsReport(env.db, { days: 30, now: later });

    expect(report.landing.all).toEqual({
      uploadClicked: 4,
      uploads: 2,
      sampleStarted: 2,
      sampleCompleted: 1,
      sampleCtaClicked: 1,
      shareLaterClicked: 2,
      shareLaterShared: 1,
      shareLaterCopied: 1,
      loginClicked: 3,
      loginClickedLanding: 1,
      loginClickedGate: 2,
      loginCompleted: 1,
      loginFailed: 1,
    });
    expect(report.landing.inApp).toMatchObject({
      uploadClicked: 2,
      uploads: 1,
      sampleStarted: 1,
      sampleCompleted: 1,
      shareLaterShared: 1,
      loginClicked: 2,
      loginCompleted: 0,
      loginFailed: 1,
    });
    expect(report.landing.notInApp).toMatchObject({
      uploadClicked: 1,
      uploads: 1,
      sampleStarted: 1,
      shareLaterCopied: 1,
      loginClicked: 1,
      loginCompleted: 1,
    });

    const text = formatAnalyticsReport(report);

    expect(text).toContain('첫 화면 깔때기');
    expect(text).toContain('사진 선택 누름 4 → 업로드 2 (50.0%)');
    expect(text).toContain('앱 안 브라우저(인스타그램·페이스북)');
  });
});

import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { type AnalyticsReportData, type DailyEventCount } from '@/server/analytics/AnalyticsStats';
import { type DbExecutor } from '@/server/db/Database';

const RETENTION_DAYS = 7;
const WEEK_DAYS = 7;
const SEOUL = 'Asia/Seoul';

type ReportWindow = { days: number; now: Date };

/** Both drivers (PGlite, node-postgres) return `{ rows }` from `execute`. */
const readRows = (result: unknown): unknown[] => {
  const rows = (result as { rows?: unknown } | null)?.rows;

  return Array.isArray(rows) ? rows : [];
};

const count = z.coerce.number();
const nullableNumber = z
  .union([z.number(), z.string(), z.null()])
  .transform((value) => (value === null ? null : Number(value)));

const readFirst = async <T>(
  db: DbExecutor,
  query: ReturnType<typeof sql>,
  schema: z.ZodType<T>,
): Promise<T> => schema.parse(readRows(await db.execute(query))[0] ?? {});

const funnelSchema = z.object({
  uploaded: count,
  recognized: count,
  claimed: count,
  drafted: count,
  published: count,
});

const qualitySchema = z.object({
  drafts: count,
  review_p50: nullableNumber,
  review_p95: nullableNumber,
  reviews: count,
  edited_p50: nullableNumber,
  edited_p95: nullableNumber,
  full_matches: count,
});

const secondMonthSchema = z.object({ publishers: count, repeat_publishers: count });
const shareSchema = z.object({ sharers: count, shared_views: count, shared_links: count });
const weeklySchema = z.object({ users: count });
const retentionSchema = z.object({ eligible: count, retained: count });
const dailyActiveSchema = z.object({ date: z.string(), users: count });
const dailyEventSchema = z.object({ date: z.string(), event: z.enum(AnalyticsEvent), count });

/** Timestamps as ISO text (both drivers bind strings the same way). */
const at = (value: Date) => sql`${value.toISOString()}::timestamptz`;
const isEvent = (event: AnalyticsEvent) => sql`event = ${event}`;
const intProperty = (key: string) => sql`(properties ->> ${key})::int`;
const boolProperty = (key: string) => sql`coalesce((properties ->> ${key})::boolean, false)`;
const seoulDate = (column: ReturnType<typeof sql>) =>
  sql`to_char(${column} at time zone ${SEOUL}, 'YYYY-MM-DD')`;

/** Spec §23.5 metrics for `[now − days, now]`, computed in SQL (keys and numbers only). */
export const collectAnalyticsReport = async (
  db: DbExecutor,
  { days, now }: ReportWindow,
): Promise<AnalyticsReportData> => {
  const since = new Date(now.getTime() - days * MS_PER_DAY);
  const inWindow = sql`created_at >= ${at(since)} and created_at <= ${at(now)}`;

  const funnel = await readFirst(
    db,
    sql`
      select
        count(distinct subject_key) filter (where ${isEvent(AnalyticsEvent.UPLOAD_STARTED)}) as uploaded,
        count(distinct subject_key) filter (
          where ${isEvent(AnalyticsEvent.RECOGNITION_COMPLETED)} and ${boolProperty('success')}
        ) as recognized,
        count(distinct subject_key) filter (where ${isEvent(AnalyticsEvent.JOB_CLAIMED)}) as claimed,
        count(distinct subject_key) filter (where ${isEvent(AnalyticsEvent.DRAFT_CREATED)}) as drafted,
        count(distinct subject_key) filter (where ${isEvent(AnalyticsEvent.MONTH_PUBLISHED)}) as published
      from analytics_events
      where ${inWindow}
    `,
    funnelSchema,
  );

  const aiDraft = sql`${isEvent(AnalyticsEvent.DRAFT_CREATED)} and not ${boolProperty('manual')}`;
  const review = isEvent(AnalyticsEvent.REVIEW_COMPLETED);
  const quality = await readFirst(
    db,
    sql`
      select
        count(*) filter (where ${aiDraft}) as drafts,
        percentile_disc(0.5) within group (order by ${intProperty('reviewCells')}) filter (where ${aiDraft}) as review_p50,
        percentile_disc(0.95) within group (order by ${intProperty('reviewCells')}) filter (where ${aiDraft}) as review_p95,
        count(*) filter (where ${review}) as reviews,
        percentile_disc(0.5) within group (order by ${intProperty('editedCells')}) filter (where ${review}) as edited_p50,
        percentile_disc(0.95) within group (order by ${intProperty('editedCells')}) filter (where ${review}) as edited_p95,
        count(*) filter (where ${review} and ${boolProperty('fullMonthMatch')}) as full_matches
      from analytics_events
      where ${inWindow}
    `,
    qualitySchema,
  );

  const secondMonth = await readFirst(
    db,
    sql`
      select
        count(distinct actor_key) as publishers,
        count(distinct actor_key) filter (where ${intProperty('monthIndex')} >= 2) as repeat_publishers
      from analytics_events
      where ${isEvent(AnalyticsEvent.MONTH_PUBLISHED)} and ${inWindow}
    `,
    secondMonthSchema,
  );

  const share = await readFirst(
    db,
    sql`
      select
        (
          select count(*) from (
            select distinct on (actor_key) actor_key, ${intProperty('visibleMonthCount')} as visible
            from analytics_events
            where ${isEvent(AnalyticsEvent.EXPORT_LINK)} and ${inWindow}
            order by actor_key, created_at desc
          ) latest
          where latest.visible > 0
        ) as sharers,
        count(*) as shared_views,
        count(distinct subject_key) as shared_links
      from analytics_events
      where ${isEvent(AnalyticsEvent.SHARED_CALENDAR_VIEWED)} and ${inWindow}
    `,
    shareSchema,
  );

  const dailyActive = readRows(
    await db.execute(sql`
      select ${seoulDate(sql`created_at`)} as date, count(distinct actor_key) as users
      from analytics_events
      where actor_key is not null and ${inWindow}
      group by 1
      order by 1
    `),
  ).map((row) => dailyActiveSchema.parse(row));

  const weekStart = new Date(now.getTime() - WEEK_DAYS * MS_PER_DAY);
  const weekly = await readFirst(
    db,
    sql`
      select count(distinct actor_key) as users
      from analytics_events
      where actor_key is not null and created_at >= ${at(weekStart)} and created_at <= ${at(now)}
    `,
    weeklySchema,
  );

  // First publish ever (not only in the window), counted when it falls in the window early enough to
  // have a full 7 days after it. A return visit is a calendar view on a later Seoul day within 7 days.
  const cohortEnd = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY);
  const retention = await readFirst(
    db,
    sql`
      with first_publish as (
        select actor_key, min(created_at) as published_at
        from analytics_events
        where ${isEvent(AnalyticsEvent.MONTH_PUBLISHED)} and actor_key is not null
        group by actor_key
      )
      select
        count(*) as eligible,
        count(*) filter (
          where exists (
            select 1 from analytics_events viewed
            where viewed.event = ${AnalyticsEvent.CALENDAR_VIEWED}
              and viewed.actor_key = first_publish.actor_key
              and ${seoulDate(sql`viewed.created_at`)} > ${seoulDate(sql`first_publish.published_at`)}
              and viewed.created_at <= first_publish.published_at + make_interval(days => ${RETENTION_DAYS})
          )
        ) as retained
      from first_publish
      where published_at >= ${at(since)} and published_at <= ${at(cohortEnd)}
    `,
    retentionSchema,
  );

  const daily: DailyEventCount[] = readRows(
    await db.execute(sql`
      select ${seoulDate(sql`created_at`)} as date, event, count(*) as count
      from analytics_events
      where ${inWindow}
      group by 1, 2
      order by 1, 2
    `),
  ).map((row) => dailyEventSchema.parse(row));

  return {
    days,
    funnel,
    quality: {
      drafts: quality.drafts,
      reviewCells: { p50: quality.review_p50, p95: quality.review_p95 },
      reviews: quality.reviews,
      editedCells: { p50: quality.edited_p50, p95: quality.edited_p95 },
      fullMonthMatches: quality.full_matches,
    },
    secondMonth: { publishers: secondMonth.publishers, repeatPublishers: secondMonth.repeat_publishers },
    share: { sharers: share.sharers, sharedViews: share.shared_views, sharedLinks: share.shared_links },
    activity: { dailyActive, weeklyActive: weekly.users },
    retention,
    daily,
  };
};

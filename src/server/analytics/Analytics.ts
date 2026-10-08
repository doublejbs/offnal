import 'server-only';

import { after } from 'next/server';

import { type AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { AnalyticsSink } from '@/domain/enums/AnalyticsSink';
import { type AnalyticsSubject, buildActorKey, buildSubjectKey } from '@/server/analytics/AnalyticsKeys';
import {
  type AnalyticsProperties,
  validateAnalyticsProperties,
} from '@/server/analytics/AnalyticsProperties';
import { getAppConfig } from '@/server/config/AppConfig';
import { getDb } from '@/server/db/Database';
import { analyticsEvents } from '@/server/db/Schema';

export type TrackInput = {
  /** The user acting (null/absent before login). Stored only as a pseudonymous key. */
  actorUserId?: string | null;
  /** What the event is about (job, calendar, team). Stored only as a pseudonymous key. */
  subject?: AnalyticsSubject | null;
  properties?: AnalyticsProperties;
};

/** One `analytics_events` row as written (also the console sink's payload). */
export type AnalyticsRow = {
  event: AnalyticsEvent;
  actorKey: string | null;
  subjectKey: string | null;
  properties: AnalyticsProperties;
  createdAt: Date;
};

type Task = () => Promise<void>;

type AnalyticsOverrides = {
  /** Replaces `after()` (with its out-of-request fallback). */
  schedule: (task: Task) => void;
  /** Replaces the DB insert. */
  write: (row: AnalyticsRow) => Promise<void>;
};

type AnalyticsGlobal = typeof globalThis & {
  __offnalAnalyticsOverrides?: Partial<AnalyticsOverrides>;
  /** Fallback writes still running (outside a request scope: scripts, tests). */
  __offnalAnalyticsPending?: Set<Promise<void>>;
  /** Last `created_at` in epoch ms: keeps event order within this instance even inside one millisecond. */
  __offnalAnalyticsLastMs?: number;
};

const analyticsGlobal = globalThis as AnalyticsGlobal;

const describeError = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

const logFailure = (stage: string, error: unknown): void => {
  console.warn(`[analytics] ${stage} failed`, { name: describeError(error) });
};

const nextTimestamp = (): Date => {
  const last = analyticsGlobal.__offnalAnalyticsLastMs ?? 0;
  const ms = Math.max(Date.now(), last + 1);

  analyticsGlobal.__offnalAnalyticsLastMs = ms;

  return new Date(ms);
};

/** Validated row with ids replaced by keys. Throws `AnalyticsPropertyError` on disallowed properties. */
export const buildAnalyticsRow = (
  event: AnalyticsEvent,
  input: TrackInput,
  secret: string,
  createdAt: Date,
): AnalyticsRow => ({
  event,
  actorKey: input.actorUserId ? buildActorKey(input.actorUserId, secret) : null,
  subjectKey: input.subject ? buildSubjectKey(input.subject, secret) : null,
  properties: validateAnalyticsProperties(input.properties ?? {}),
  createdAt,
});

const writeToDb = async (row: AnalyticsRow): Promise<void> => {
  const db = await getDb();

  await db.insert(analyticsEvents).values(row);
};

const runDetached = (task: Task): void => {
  const pending = (analyticsGlobal.__offnalAnalyticsPending ??= new Set());
  const promise = task().finally(() => {
    pending.delete(promise);
  });

  pending.add(promise);
};

/** After the response inside a request (`after`); outside one (`after` throws) a detached caught promise. */
const scheduleAfterResponse = (task: Task): void => {
  try {
    after(task);
  } catch {
    runDetached(task);
  }
};

/**
 * Records a usage event (Spec §23). Never throws and never delays the response: the DB write runs after
 * the response. Invalid properties drop the event. Failures are logged by error name only.
 */
export const track = (event: AnalyticsEvent, input: TrackInput = {}): void => {
  try {
    const config = getAppConfig();

    if (config.analyticsSink === AnalyticsSink.OFF) {
      return;
    }

    const row = buildAnalyticsRow(event, input, config.appSecret, nextTimestamp());

    if (config.analyticsSink === AnalyticsSink.CONSOLE) {
      console.info(JSON.stringify({ type: 'analytics', ...row }));

      return;
    }

    const overrides = analyticsGlobal.__offnalAnalyticsOverrides ?? {};
    const write = overrides.write ?? writeToDb;
    const schedule = overrides.schedule ?? scheduleAfterResponse;

    schedule(async () => {
      try {
        await write(row);
      } catch (error: unknown) {
        logFailure('write', error);
      }
    });
  } catch (error: unknown) {
    logFailure('track', error);
  }
};

/** Replaces scheduling/writing (null restores the defaults). Tests only. */
export const setAnalyticsOverridesForTesting = (overrides: Partial<AnalyticsOverrides> | null): void => {
  analyticsGlobal.__offnalAnalyticsOverrides = overrides ?? undefined;
};

/** Waits for every fallback write started so far (and any they start). Tests only. */
export const flushAnalyticsForTesting = async (): Promise<void> => {
  const pending = analyticsGlobal.__offnalAnalyticsPending;

  while (pending && pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
};

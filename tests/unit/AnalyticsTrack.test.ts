import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { AnalyticsSubjectKind } from '@/domain/enums/AnalyticsSubjectKind';
import {
  type AnalyticsRow,
  flushAnalyticsForTesting,
  setAnalyticsOverridesForTesting,
  track,
} from '@/server/analytics/Analytics';
import { buildActorKey, buildSubjectKey } from '@/server/analytics/AnalyticsKeys';
import { getAppConfig } from '@/server/config/AppConfig';

import { createEnvSandbox } from '../helpers/EnvSandbox';

const USER_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const JOB_ID = '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9';

const sandbox = createEnvSandbox();

type Task = () => Promise<void>;

const recordWrites = () => {
  const rows: AnalyticsRow[] = [];

  setAnalyticsOverridesForTesting({
    write: async (row) => {
      rows.push(row);
    },
  });

  return rows;
};

afterEach(() => {
  setAnalyticsOverridesForTesting(null);
  sandbox.restore();
  vi.restoreAllMocks();
});

describe('track', () => {
  it('does nothing with sink=off (the test default)', async () => {
    const rows = recordWrites();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    track(AnalyticsEvent.UPLOAD_STARTED, { subject: { kind: AnalyticsSubjectKind.JOB, id: JOB_ID } });
    await flushAnalyticsForTesting();

    expect(rows).toEqual([]);
    expect(info).not.toHaveBeenCalled();
  });

  it('logs keyed JSON with sink=console and never the raw ids', async () => {
    sandbox.set({ ANALYTICS_SINK: 'console' });

    const rows = recordWrites();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    track(AnalyticsEvent.JOB_CLAIMED, {
      actorUserId: USER_ID,
      subject: { kind: AnalyticsSubjectKind.JOB, id: JOB_ID },
    });
    await flushAnalyticsForTesting();

    expect(rows).toEqual([]);
    expect(info).toHaveBeenCalledTimes(1);

    const logged = String(info.mock.calls[0]?.[0]);

    expect(JSON.parse(logged)).toMatchObject({
      type: 'analytics',
      event: AnalyticsEvent.JOB_CLAIMED,
      actorKey: buildActorKey(USER_ID, getAppConfig().appSecret),
      subjectKey: buildSubjectKey({ kind: AnalyticsSubjectKind.JOB, id: JOB_ID }, getAppConfig().appSecret),
    });
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain(JOB_ID);
  });

  it('writes one keyed row with sink=db', async () => {
    sandbox.set({ ANALYTICS_SINK: 'db' });

    const rows = recordWrites();

    track(AnalyticsEvent.RECOGNITION_COMPLETED, {
      subject: { kind: AnalyticsSubjectKind.JOB, id: JOB_ID },
      properties: { success: true, attempt: 1, ms: 120 },
    });
    await flushAnalyticsForTesting();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: AnalyticsEvent.RECOGNITION_COMPLETED,
      actorKey: null,
      subjectKey: buildSubjectKey({ kind: AnalyticsSubjectKind.JOB, id: JOB_ID }, getAppConfig().appSecret),
      properties: { success: true, attempt: 1, ms: 120 },
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(rows[0])).not.toContain(JOB_ID);
  });

  it('defers the write: nothing is written before the scheduled task runs', async () => {
    sandbox.set({ ANALYTICS_SINK: 'db' });

    const rows: AnalyticsRow[] = [];
    const tasks: Task[] = [];

    setAnalyticsOverridesForTesting({
      schedule: (task) => {
        tasks.push(task);
      },
      write: async (row) => {
        rows.push(row);
      },
    });

    track(AnalyticsEvent.CALENDAR_VIEWED, { actorUserId: USER_ID });

    expect(tasks).toHaveLength(1);
    expect(rows).toEqual([]);

    await tasks[0]!();

    expect(rows).toHaveLength(1);
  });

  it('falls back to a caught promise when after() is unavailable (outside a request scope)', async () => {
    sandbox.set({ ANALYTICS_SINK: 'db' });

    const rows = recordWrites();

    // No schedule override: the default `after` throws outside a request, so the fallback runs the write.
    expect(() => track(AnalyticsEvent.CALENDAR_VIEWED, { actorUserId: USER_ID })).not.toThrow();
    await flushAnalyticsForTesting();

    expect(rows).toHaveLength(1);
  });

  it('never throws: write failures are logged by error name only', async () => {
    sandbox.set({ ANALYTICS_SINK: 'db' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setAnalyticsOverridesForTesting({
      write: async () => {
        throw new TypeError(`insert failed for ${USER_ID}`);
      },
    });

    expect(() => track(AnalyticsEvent.CALENDAR_VIEWED, { actorUserId: USER_ID })).not.toThrow();
    await flushAnalyticsForTesting();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).toContain('TypeError');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(USER_ID);
  });

  it('drops events with invalid properties without throwing or writing', async () => {
    sandbox.set({ ANALYTICS_SINK: 'db' });

    const rows = recordWrites();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const properties = { displayName: '김간호' } as unknown as Record<string, number>;

    expect(() => track(AnalyticsEvent.DRAFT_CREATED, { actorUserId: USER_ID, properties })).not.toThrow();
    await flushAnalyticsForTesting();

    expect(rows).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).toContain('AnalyticsPropertyError');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('김간호');
  });

  it('never throws when the schedule itself fails', () => {
    sandbox.set({ ANALYTICS_SINK: 'db' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setAnalyticsOverridesForTesting({
      schedule: () => {
        throw new RangeError('boom');
      },
    });

    expect(() => track(AnalyticsEvent.CALENDAR_VIEWED, { actorUserId: USER_ID })).not.toThrow();
    expect(JSON.stringify(warn.mock.calls)).toContain('RangeError');
  });
});

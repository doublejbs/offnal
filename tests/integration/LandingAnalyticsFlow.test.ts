import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as eventsRoute } from '@/app/api/events/route';
import { POST as uploadRoute } from '@/app/api/recognitions/route';
import { GET as callbackRoute } from '@/app/auth/callback/route';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { LoginClickSource } from '@/domain/enums/LoginClickSource';
import { LoginFailureKind } from '@/domain/enums/LoginFailureKind';
import { ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';
import { flushAnalyticsForTesting } from '@/server/analytics/Analytics';
import { buildActorKey } from '@/server/analytics/AnalyticsKeys';
import { getAppConfig } from '@/server/config/AppConfig';
import { analyticsEvents, type AnalyticsEventRow, rateLimitCounters, users } from '@/server/db/Schema';

import {
  type ApiTestClient,
  buildUploadForm,
  createApiTestClient,
  createTablePng,
  type IntegrationEnvironment,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createFakeSupabase, SUPABASE_KAKAO_ENV } from '../helpers/FakeSupabase';
import { devLogin } from '../helpers/OffnalFlows';

/** Spec §26.5: client events through POST /api/events, server-side login_failed, server-computed inApp. */

const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.29.87 (iPhone15,3; iOS 18_5; ko_KR; ko; scale=3.00)';
const SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

let env: IntegrationEnvironment;
const sandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

beforeEach(async () => {
  sandbox.set({ ANALYTICS_SINK: 'db' });
  await flushAnalyticsForTesting();
  await env.db.delete(analyticsEvents);
});

afterEach(async () => {
  await flushAnalyticsForTesting();
  sandbox.restore();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await env.close();
});

const readEvents = async (): Promise<AnalyticsEventRow[]> => {
  await flushAnalyticsForTesting();

  return env.db.select().from(analyticsEvents).orderBy(asc(analyticsEvents.createdAt));
};

const sendEvent = (
  client: ApiTestClient,
  body: unknown,
  options: { origin?: string | null; userAgent?: string; raw?: string } = {},
): Promise<Response> =>
  client.send(eventsRoute, '/api/events', {
    method: 'POST',
    origin: options.origin,
    headers: {
      'content-type': 'application/json',
      ...(options.userAgent ? { 'user-agent': options.userAgent } : {}),
    },
    body: options.raw ?? JSON.stringify(body),
  });

describe('POST /api/events', () => {
  it('stores an allowed client event with validated properties and a server-computed inApp', async () => {
    const client = createApiTestClient();
    const responses = [
      await sendEvent(client, { event: AnalyticsEvent.LANDING_UPLOAD_CLICKED }, { userAgent: INSTAGRAM_UA }),
      await sendEvent(
        client,
        { event: AnalyticsEvent.SHARE_LATER_CLICKED, properties: { method: ShareLaterMethod.SHARE } },
        { userAgent: SAFARI_UA },
      ),
      await sendEvent(client, {
        event: AnalyticsEvent.LOGIN_CLICKED,
        properties: { from: LoginClickSource.LANDING },
      }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    }

    const rows = await readEvents();

    expect(rows.map((row) => [row.event, row.actorKey, row.subjectKey, row.properties])).toEqual([
      [AnalyticsEvent.LANDING_UPLOAD_CLICKED, null, null, { inApp: true }],
      [AnalyticsEvent.SHARE_LATER_CLICKED, null, null, { method: ShareLaterMethod.SHARE, inApp: false }],
      [AnalyticsEvent.LOGIN_CLICKED, null, null, { from: LoginClickSource.LANDING, inApp: false }],
    ]);
    // The User-Agent itself is never stored.
    expect(JSON.stringify(rows)).not.toMatch(/Instagram|Safari|Mozilla/);
  });

  it('drops (still 204) a cross-origin or origin-less request', async () => {
    const client = createApiTestClient();
    const body = { event: AnalyticsEvent.SAMPLE_STARTED };

    expect((await sendEvent(client, body, { origin: 'https://evil.example' })).status).toBe(204);
    expect((await sendEvent(client, body, { origin: null })).status).toBe(204);
    expect(await readEvents()).toEqual([]);
  });

  it('drops (still 204) server-only or unknown events, bad properties and malformed bodies', async () => {
    const client = createApiTestClient();
    const bodies: unknown[] = [
      { event: AnalyticsEvent.LOGIN_FAILED, properties: { kind: LoginFailureKind.CANCELLED } },
      { event: AnalyticsEvent.MONTH_PUBLISHED },
      { event: 'free_text' },
      { event: AnalyticsEvent.SHARE_LATER_CLICKED, properties: { method: 'email' } },
      { event: AnalyticsEvent.LOGIN_CLICKED, properties: { from: LoginClickSource.GATE, name: '김간호' } },
      { event: AnalyticsEvent.SAMPLE_STARTED, properties: { inApp: false } },
    ];

    for (const body of bodies) {
      expect((await sendEvent(client, body)).status).toBe(204);
    }

    expect((await sendEvent(client, null, { raw: '{not json' })).status).toBe(204);
    expect(
      (
        await sendEvent(client, null, {
          raw: JSON.stringify({ event: AnalyticsEvent.SAMPLE_STARTED, pad: 'x'.repeat(5000) }),
        })
      ).status,
    ).toBe(204);
    expect(await readEvents()).toEqual([]);
  });

  it('takes the actor from the session only, never from the body', async () => {
    const client = createApiTestClient();

    expect((await devLogin(client, '이벤트 로그인 사용자')).status).toBe(303);
    await flushAnalyticsForTesting();
    await env.db.delete(analyticsEvents);

    const [user] = await env.db.select().from(users).where(eq(users.displayName, '이벤트 로그인 사용자'));

    expect((await sendEvent(client, { event: AnalyticsEvent.SAMPLE_CTA_CLICKED })).status).toBe(204);
    expect(
      (await sendEvent(client, { event: AnalyticsEvent.SAMPLE_CTA_CLICKED, actorUserId: 'someone-else' }))
        .status,
    ).toBe(204);

    const rows = await readEvents();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: AnalyticsEvent.SAMPLE_CTA_CLICKED,
      actorKey: buildActorKey(user!.id, getAppConfig().appSecret),
      subjectKey: null,
    });
    expect(JSON.stringify(rows)).not.toContain(user!.id);
  });

  it('limits events per IP per day (over the limit: still 204, not stored)', async () => {
    sandbox.set({ RATE_LIMIT_EVENTS_IP_DAILY: '2' });

    const client = createApiTestClient();
    const other = createApiTestClient();

    for (let index = 0; index < 4; index += 1) {
      expect((await sendEvent(client, { event: AnalyticsEvent.SAMPLE_STARTED })).status).toBe(204);
    }

    expect((await sendEvent(other, { event: AnalyticsEvent.SAMPLE_STARTED })).status).toBe(204);
    expect(await readEvents()).toHaveLength(3);
    // The counter key is hashed: the raw IP is not in the table.
    expect(JSON.stringify(await env.db.select().from(rateLimitCounters))).not.toContain(client.ip);
  });

  it('answers 204 without storing when analytics is off', async () => {
    sandbox.set({ ANALYTICS_SINK: 'off' });

    const client = createApiTestClient();

    expect((await sendEvent(client, { event: AnalyticsEvent.SAMPLE_COMPLETED })).status).toBe(204);
    expect(await readEvents()).toEqual([]);
  });
});

describe('server events', () => {
  it('adds inApp to existing server events from the request User-Agent', async () => {
    const instagram = createApiTestClient();
    const regular = createApiTestClient();
    const bytes = await createTablePng();

    for (const [client, userAgent] of [
      [instagram, INSTAGRAM_UA],
      [regular, SAFARI_UA],
    ] as const) {
      const response = await client.send(uploadRoute, '/api/recognitions', {
        method: 'POST',
        form: buildUploadForm(bytes),
        headers: { 'user-agent': userAgent },
      });

      expect(response.status).toBe(201);
    }

    const uploads = (await readEvents()).filter((row) => row.event === AnalyticsEvent.UPLOAD_STARTED);

    expect(uploads.map((row) => row.properties)).toEqual([
      { team: false, inApp: true },
      { team: false, inApp: false },
    ]);
  });

  it('records login_failed in the callback with a fixed kind only', async () => {
    const client = createApiTestClient();
    const cancelled = await client.send(
      callbackRoute,
      '/auth/callback?error=access_denied&error_description=%EA%B9%80%EA%B0%84%ED%98%B8&returnTo=%2F',
      { headers: { 'user-agent': INSTAGRAM_UA } },
    );
    const missingCode = await client.send(callbackRoute, '/auth/callback?returnTo=%2F');
    // Kakao is not enabled in this (demo, dev-login) environment.
    const unavailable = await client.send(callbackRoute, '/auth/callback?code=abc&returnTo=%2F');

    for (const response of [cancelled, missingCode, unavailable]) {
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/?login=failed`);
    }

    const rows = await readEvents();

    expect(rows.map((row) => [row.event, row.actorKey, row.properties])).toEqual([
      [AnalyticsEvent.LOGIN_FAILED, null, { kind: LoginFailureKind.CANCELLED, inApp: true }],
      [AnalyticsEvent.LOGIN_FAILED, null, { kind: LoginFailureKind.CANCELLED, inApp: false }],
      [AnalyticsEvent.LOGIN_FAILED, null, { kind: LoginFailureKind.UNAVAILABLE, inApp: false }],
    ]);
    expect(JSON.stringify(rows)).not.toContain('access_denied');
  });

  it('records a failed code exchange as exchange_failed', async () => {
    const fake = createFakeSupabase();

    fake.install();
    sandbox.set({ APP_MODE: 'live', ...SUPABASE_KAKAO_ENV });

    const client = createApiTestClient();
    const response = await client.send(callbackRoute, '/auth/callback?code=unknown&returnTo=%2F');

    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/?login=failed`);

    const rows = await readEvents();

    expect(rows.map((row) => [row.event, row.properties])).toEqual([
      [AnalyticsEvent.LOGIN_FAILED, { kind: LoginFailureKind.EXCHANGE_FAILED, inApp: false }],
    ]);
  });
});

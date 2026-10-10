import { asc } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as callbackRoute } from '@/app/auth/callback/route';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { LoginFailureKind } from '@/domain/enums/LoginFailureKind';
import { flushAnalyticsForTesting } from '@/server/analytics/Analytics';
import type * as RequestContextModule from '@/server/http/RequestContext';
import { analyticsEvents } from '@/server/db/Schema';

import {
  createApiTestClient,
  type IntegrationEnvironment,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createFakeSupabase, SUPABASE_KAKAO_ENV } from '../helpers/FakeSupabase';

/**
 * Spec §26.5: a failure on our side before the code exchange (DB, pre-login context) is `server_error`,
 * not `exchange_failed` — the provider was never asked.
 */

const failure = vi.hoisted(() => ({ preLoginContext: false }));

vi.mock('@/server/http/RequestContext', async (importOriginal) => {
  const actual = await importOriginal<typeof RequestContextModule>();

  return {
    ...actual,
    getPreLoginContext: (...args: Parameters<typeof actual.getPreLoginContext>) => {
      if (failure.preLoginContext) {
        return Promise.reject(new Error('db unavailable'));
      }

      return actual.getPreLoginContext(...args);
    },
  };
});

let env: IntegrationEnvironment;
const sandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

beforeEach(async () => {
  sandbox.set({ ANALYTICS_SINK: 'db', APP_MODE: 'live', ...SUPABASE_KAKAO_ENV });
  await flushAnalyticsForTesting();
  await env.db.delete(analyticsEvents);
});

afterEach(async () => {
  failure.preLoginContext = false;
  await flushAnalyticsForTesting();
  sandbox.restore();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await env.close();
});

const readKinds = async (): Promise<unknown[]> => {
  await flushAnalyticsForTesting();

  const rows = await env.db.select().from(analyticsEvents).orderBy(asc(analyticsEvents.createdAt));

  return rows.map((row) => [row.event, row.properties]);
};

describe('login_failed kind', () => {
  it('records server_error when our side fails before the code exchange', async () => {
    const fake = createFakeSupabase();

    fake.install();
    failure.preLoginContext = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await createApiTestClient().send(
      callbackRoute,
      '/auth/callback?code=unknown&returnTo=%2F',
    );

    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/?login=failed`);
    expect(await readKinds()).toEqual([
      [AnalyticsEvent.LOGIN_FAILED, { kind: LoginFailureKind.SERVER_ERROR, inApp: false }],
    ]);
  });

  it('still records exchange_failed when the exchange itself fails', async () => {
    const fake = createFakeSupabase();

    fake.install();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await createApiTestClient().send(callbackRoute, '/auth/callback?code=unknown&returnTo=%2F');

    expect(await readKinds()).toEqual([
      [AnalyticsEvent.LOGIN_FAILED, { kind: LoginFailureKind.EXCHANGE_FAILED, inApp: false }],
    ]);
  });
});

import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { config, proxy } from '@/proxy';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import {
  createFakeSupabase,
  EXPIRED_PREFIX,
  FAKE_SESSION_COOKIE,
  SUPABASE_KAKAO_ENV,
} from '../helpers/FakeSupabase';

const APP_URL = 'http://localhost:3100';

const envSandbox = createEnvSandbox();
const fake = createFakeSupabase();

afterEach(() => {
  fake.uninstall();
  envSandbox.restore();
});

const buildRequest = (cookie?: string): NextRequest =>
  new NextRequest(new URL('/calendar', APP_URL), { headers: cookie ? { cookie } : {} });

describe('proxy', () => {
  it('passes requests through untouched when Supabase is not configured', async () => {
    fake.install();

    const response = await proxy(buildRequest(`${FAKE_SESSION_COOKIE}=${EXPIRED_PREFIX}abc`));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(fake.clientCount()).toBe(0);
  });

  it('passes requests through when the configuration itself is invalid', async () => {
    envSandbox.set({ ...SUPABASE_KAKAO_ENV, OFFNAL_ENV: 'staging' });
    fake.install();

    const response = await proxy(buildRequest(`${FAKE_SESSION_COOKIE}=${EXPIRED_PREFIX}abc`));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(fake.clientCount()).toBe(0);
  });

  it('skips requests without Supabase cookies', async () => {
    envSandbox.set(SUPABASE_KAKAO_ENV);
    fake.install();

    const response = await proxy(buildRequest('offnal_anon=abc'));

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(fake.clientCount()).toBe(0);
  });

  it('refreshes an expiring Supabase session and forwards the new cookies', async () => {
    envSandbox.set(SUPABASE_KAKAO_ENV);
    fake.install();

    const userId = randomUUID();
    const response = await proxy(buildRequest(`${FAKE_SESSION_COOKIE}=${EXPIRED_PREFIX}${userId}`));
    const setCookies = response.headers.getSetCookie();

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(
      setCookies.some((cookie) =>
        cookie.startsWith(`${FAKE_SESSION_COOKIE}=${fake.sessionCookieFor(userId)}`),
      ),
    ).toBe(true);
    expect(response.headers.get('cache-control')).toContain('no-store');
    // Downstream handlers see the refreshed value, not the stale request cookie.
    expect(response.headers.get('x-middleware-override-headers')).toContain('cookie');
    expect(response.headers.get('x-middleware-request-cookie')).toContain(fake.sessionCookieFor(userId));
  });

  it('excludes static assets, the payment webhook and cron from the matcher', () => {
    const [matcher] = config.matcher;

    expect(matcher).toContain('_next/static');
    expect(matcher).toContain('_next/image');
    expect(matcher).toContain('api/payments/webhook');
    expect(matcher).toContain('api/cron');
  });
});

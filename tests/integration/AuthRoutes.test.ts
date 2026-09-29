import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GET as publicConfigRoute } from '@/app/api/config/public/route';
import { GET as candidatesRoute } from '@/app/api/recognitions/[id]/candidates/route';
import { GET as callbackRoute } from '@/app/auth/callback/route';
import { GET as loginRoute } from '@/app/auth/login/route';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createLoggedInJob, devLogin } from '../helpers/OffnalFlows';

const LIVE_GOOGLE_ENV: Record<string, string> = {
  APP_MODE: 'live',
  AUTH_PROVIDERS: 'google',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
};

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

const envSandbox = createEnvSandbox();

afterEach(() => {
  envSandbox.restore();
});

afterAll(async () => {
  await env.close();
});

const useLiveGoogle = (): void => {
  envSandbox.set(LIVE_GOOGLE_ENV);
};

describe('dev login', () => {
  it('is 404 outside demo mode', async () => {
    envSandbox.set({ APP_MODE: 'live' });

    const client = createApiTestClient();
    const response = await devLogin(client, '라이브');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type') ?? '').not.toContain('json');
    expect(client.cookies.has('offnal_session')).toBe(false);
  });

  it('only redirects to relative paths', async () => {
    const client = createApiTestClient();

    for (const returnTo of [
      '//evil.example/x',
      'https://evil.example',
      '/\\evil.example',
      'relative',
      '/.//evil.example',
      '/a/..//evil.example',
    ]) {
      const response = await devLogin(client, '리다이렉트', returnTo);

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/`);
    }
  });

  it('redirects invalid submissions back with login=failed instead of JSON', async () => {
    const client = createApiTestClient();
    const response = await client.send((await import('@/app/auth/dev-login/route')).POST, '/auth/dev-login', {
      json: { displayName: '가'.repeat(201), returnTo: '/recognitions/abc' },
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/abc?login=failed`);
    expect(response.headers.get('content-type') ?? '').not.toContain('json');
    expect(client.cookies.has('offnal_session')).toBe(false);
  });

  it('accepts form submissions', async () => {
    const client = createApiTestClient();
    const form = new FormData();
    const { POST } = await import('@/app/auth/dev-login/route');

    form.set('displayName', '폼 사용자');
    form.set('returnTo', '/calendar');

    const response = await client.send(POST, '/auth/dev-login', { method: 'POST', form });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/calendar`);
    expect(client.cookies.has('offnal_session')).toBe(true);
  });

  it('rotates the session on every login', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '회전 사용자');
    const firstToken = client.cookies.get('offnal_session');

    await devLogin(client, '회전 사용자');

    const secondToken = client.cookies.get('offnal_session');

    expect(secondToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondToken).not.toBe(firstToken);

    client.cookies.set('offnal_session', firstToken ?? '');

    const withOldToken = await client.send(candidatesRoute, `/api/recognitions/${jobId}/candidates`, {
      params: { id: jobId },
    });

    expect(withOldToken.status).toBe(401);
  });
});

describe('OAuth login', () => {
  it('redirects back with login=failed (never JSON) for a provider that is not enabled or not configured', async () => {
    const client = createApiTestClient();
    const disabled = await client.send(loginRoute, '/auth/login?provider=google&returnTo=/recognitions/x');

    expect(disabled.status).toBe(302);
    expect(disabled.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/x?login=failed`);
    expect(disabled.headers.get('content-type')).toBeNull();

    envSandbox.set({ APP_MODE: 'live', AUTH_PROVIDERS: 'google', GOOGLE_CLIENT_ID: undefined });

    const unconfigured = await client.send(loginRoute, '/auth/login?provider=google&returnTo=//evil.example');

    expect(unconfigured.status).toBe(302);
    expect(unconfigured.headers.get('location')).toBe(`${TEST_APP_URL}/?login=failed`);
  });

  it('redirects to Google with state and PKCE, then maps cancel and state mismatch to login=failed', async () => {
    useLiveGoogle();

    const client = createApiTestClient();
    const loginResponse = await client.send(
      loginRoute,
      '/auth/login?provider=google&returnTo=/recognitions/abc',
    );
    const location = new URL(loginResponse.headers.get('location') ?? '');

    expect(loginResponse.status).toBe(302);
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(`${TEST_APP_URL}/auth/callback`);
    expect(client.cookies.has('offnal_oauth')).toBe(true);

    const state = location.searchParams.get('state') ?? '';
    const cancelled = await client.send(callbackRoute, `/auth/callback?error=access_denied&state=${state}`);

    expect(cancelled.status).toBe(302);
    expect(cancelled.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/abc?login=failed`);
    expect(client.cookies.has('offnal_oauth')).toBe(false);

    await client.send(loginRoute, '/auth/login?provider=google&returnTo=/recognitions/abc');

    const mismatched = await client.send(callbackRoute, '/auth/callback?code=abc&state=wrong');

    expect(mismatched.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/abc?login=failed`);
    expect(client.cookies.has('offnal_session')).toBe(false);
  });

  it('falls back to / when the callback has no login cookie', async () => {
    const client = createApiTestClient();
    const response = await client.send(callbackRoute, '/auth/callback?code=abc&state=def');

    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/?login=failed`);
  });
});

describe('public config', () => {
  it('exposes only non-secret settings', async () => {
    const client = createApiTestClient();
    const response = await client.send(publicConfigRoute, '/api/config/public');
    const body = await readJson<PublicConfigResponse>(response);

    expect(body).toMatchObject({
      appMode: AppMode.DEMO,
      priceKrw: 1900,
      freeMonthLimit: 2,
      authProviders: [AuthProviderType.DEV],
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

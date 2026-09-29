import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as publicConfigRoute } from '@/app/api/config/public/route';
import { GET as candidatesRoute } from '@/app/api/recognitions/[id]/candidates/route';
import { GET as callbackRoute } from '@/app/auth/callback/route';
import { GET as loginRoute } from '@/app/auth/login/route';
import { POST as logoutRoute } from '@/app/auth/logout/route';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthIdentityProvider } from '@/domain/enums/AuthIdentityProvider';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import { authIdentities, recognitionJobs, users } from '@/server/db/Schema';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import {
  createFakeSupabase,
  EXPIRED_PREFIX,
  FAKE_SESSION_COOKIE,
  FAKE_SUPABASE_URL,
  FAKE_VERIFIER_COOKIE,
  SUPABASE_KAKAO_ENV,
} from '../helpers/FakeSupabase';
import { createLoggedInJob, devLogin, uploadAndProcess } from '../helpers/OffnalFlows';

const OPEN_REDIRECT_PROBES = [
  '//evil.example/x',
  'https://evil.example',
  '/\\evil.example',
  'relative',
  '/.//evil.example',
  '/a/..//evil.example',
];

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

    for (const returnTo of OPEN_REDIRECT_PROBES) {
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

const useKakao = (overrides: Record<string, string | undefined> = {}): void => {
  envSandbox.set({ APP_MODE: 'live', ...SUPABASE_KAKAO_ENV, ...overrides });
};

const findJobOwner = async (jobId: string): Promise<string | null> => {
  const [job] = await env.db
    .select({ userId: recognitionJobs.userId })
    .from(recognitionJobs)
    .where(eq(recognitionJobs.id, jobId));

  return job?.userId ?? null;
};

const findSupabaseIdentities = async (subject: string) =>
  env.db
    .select({ userId: authIdentities.userId, email: authIdentities.email })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, AuthIdentityProvider.SUPABASE),
        eq(authIdentities.providerSubject, subject),
      ),
    );

const kakaoLogin = async (client: ApiTestClient, code: string, returnTo: string): Promise<Response> => {
  await client.send(loginRoute, `/auth/login?provider=kakao&returnTo=${encodeURIComponent(returnTo)}`);

  return client.send(callbackRoute, `/auth/callback?code=${code}&returnTo=${encodeURIComponent(returnTo)}`);
};

const requestCandidates = async (client: ApiTestClient, jobId: string): Promise<Response> =>
  client.send(candidatesRoute, `/api/recognitions/${jobId}/candidates`, { params: { id: jobId } });

describe('Kakao login via Supabase', () => {
  const fake = createFakeSupabase();

  beforeEach(() => {
    fake.install();
  });

  afterEach(() => {
    fake.uninstall();
  });

  it('redirects back with login=failed (never JSON) for a provider that is not enabled or not configured', async () => {
    const client = createApiTestClient();
    const disabled = await client.send(loginRoute, '/auth/login?provider=kakao&returnTo=/recognitions/x');

    expect(disabled.status).toBe(302);
    expect(disabled.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/x?login=failed`);
    expect(disabled.headers.get('content-type')).toBeNull();

    const unknown = await client.send(loginRoute, '/auth/login?provider=google&returnTo=/recognitions/x');

    expect(unknown.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/x?login=failed`);

    useKakao({ NEXT_PUBLIC_SUPABASE_URL: undefined });

    const unconfigured = await client.send(loginRoute, '/auth/login?provider=kakao&returnTo=//evil.example');

    expect(unconfigured.status).toBe(302);
    expect(unconfigured.headers.get('location')).toBe(`${TEST_APP_URL}/?login=failed`);
    expect(unconfigured.headers.get('content-type')).toBeNull();
    expect(fake.calls.signInWithOAuth).toHaveLength(0);
  });

  it('starts the PKCE flow with a sanitized returnTo in redirectTo', async () => {
    useKakao();

    const client = createApiTestClient();
    const response = await client.send(loginRoute, '/auth/login?provider=kakao&returnTo=/recognitions/abc');
    const [credentials] = fake.calls.signInWithOAuth.slice(-1);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(
      new RegExp(`^${FAKE_SUPABASE_URL}/auth/v1/authorize\\?`),
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(credentials).toEqual({
      provider: 'kakao',
      options: {
        redirectTo: `${TEST_APP_URL}/auth/callback?returnTo=%2Frecognitions%2Fabc`,
        skipBrowserRedirect: true,
      },
    });
    // The PKCE code verifier cookie written by Supabase travels with the redirect.
    expect(client.cookies.has(FAKE_VERIFIER_COOKIE)).toBe(true);
    expect(client.cookies.has('offnal_session')).toBe(false);

    for (const returnTo of OPEN_REDIRECT_PROBES) {
      await client.send(loginRoute, `/auth/login?provider=kakao&returnTo=${encodeURIComponent(returnTo)}`);

      expect(fake.calls.signInWithOAuth.at(-1)?.options?.redirectTo).toBe(
        `${TEST_APP_URL}/auth/callback?returnTo=%2F`,
      );
    }
  });

  it('creates the app user, claims the anonymous job and returns without an offnal_session', async () => {
    useKakao();

    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);
    const supabaseUserId = randomUUID();

    expect((await requestCandidates(client, jobId)).status).toBe(401);

    fake.registerCode('code-success', { id: supabaseUserId, email: 'haru@example.com', nickname: '하루' });

    const response = await kakaoLogin(client, 'code-success', `/recognitions/${jobId}`);
    const [identity] = await findSupabaseIdentities(supabaseUserId);
    const [user] = await env.db
      .select()
      .from(users)
      .where(eq(users.id, identity?.userId ?? randomUUID()));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/${jobId}`);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('offnal_session='))).toBe(
      false,
    );
    expect(client.cookies.has('offnal_session')).toBe(false);
    expect(client.cookies.get(FAKE_SESSION_COOKIE)).toBe(fake.sessionCookieFor(supabaseUserId));
    expect(client.cookies.has(FAKE_VERIFIER_COOKIE)).toBe(false);
    expect(identity?.email).toBe('haru@example.com');
    expect(user?.displayName).toBe('하루');
    expect(await findJobOwner(jobId)).toBe(user?.id);
    expect((await requestCandidates(client, jobId)).status).toBe(200);
  });

  it('maps a cancelled login, a missing code and a failed exchange to login=failed and keeps the job', async () => {
    useKakao();

    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);
    const returnTo = encodeURIComponent(`/recognitions/${jobId}`);
    const failedUrl = `${TEST_APP_URL}/recognitions/${jobId}?login=failed`;
    const exchangesBefore = fake.calls.exchangeCodeForSession.length;

    await client.send(loginRoute, `/auth/login?provider=kakao&returnTo=${returnTo}`);

    const cancelled = await client.send(
      callbackRoute,
      `/auth/callback?error=access_denied&error_description=User%20denied&returnTo=${returnTo}`,
    );
    const missingCode = await client.send(callbackRoute, `/auth/callback?returnTo=${returnTo}`);
    const badExchange = await client.send(callbackRoute, `/auth/callback?code=unknown&returnTo=${returnTo}`);
    const evilReturn = await client.send(
      callbackRoute,
      '/auth/callback?code=unknown&returnTo=//evil.example',
    );

    for (const response of [cancelled, missingCode, badExchange]) {
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(failedUrl);
      expect(response.headers.get('content-type')).toBeNull();
    }

    expect(evilReturn.headers.get('location')).toBe(`${TEST_APP_URL}/?login=failed`);
    expect(fake.calls.exchangeCodeForSession.slice(exchangesBefore)).toEqual(['unknown', 'unknown']);
    expect(client.cookies.has(FAKE_SESSION_COOKIE)).toBe(false);
    expect(await findJobOwner(jobId)).toBeNull();
    expect((await requestCandidates(client, jobId)).status).toBe(401);
  });

  it('maps the same Supabase user to the same app user on every login', async () => {
    useKakao();

    const supabaseUserId = randomUUID();
    const first = createApiTestClient();
    const second = createApiTestClient();

    fake.registerCode('code-first', { id: supabaseUserId });
    fake.registerCode('code-second', { id: supabaseUserId });
    await kakaoLogin(first, 'code-first', '/calendar');
    await kakaoLogin(second, 'code-second', '/calendar');

    const identities = await findSupabaseIdentities(supabaseUserId);
    const [user] = await env.db
      .select()
      .from(users)
      .where(eq(users.id, identities[0]?.userId ?? randomUUID()));

    expect(identities).toHaveLength(1);
    expect(identities[0]?.email).toBeNull();
    expect(user?.displayName).toBe('오프날 사용자');
  });

  it('treats a forged or unknown Supabase session as logged out', async () => {
    useKakao();

    const owner = createApiTestClient();
    const jobId = await uploadAndProcess(owner);
    const supabaseUserId = randomUUID();

    fake.registerCode('code-owner', { id: supabaseUserId });
    await kakaoLogin(owner, 'code-owner', `/recognitions/${jobId}`);

    const forger = createApiTestClient();

    forger.cookies.set(FAKE_SESSION_COOKIE, `forged.${supabaseUserId}`);
    expect((await requestCandidates(forger, jobId)).status).toBe(401);

    // Verified, but no app user was ever created for this Supabase user (callback never completed).
    const stranger = createApiTestClient();

    stranger.cookies.set(FAKE_SESSION_COOKIE, fake.sessionCookieFor(randomUUID()));
    expect((await requestCandidates(stranger, jobId)).status).toBe(401);
  });

  it('applies refreshed Supabase cookies to API responses', async () => {
    useKakao();

    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);
    const supabaseUserId = randomUUID();

    fake.registerCode('code-refresh', { id: supabaseUserId });
    await kakaoLogin(client, 'code-refresh', `/recognitions/${jobId}`);
    client.cookies.set(FAKE_SESSION_COOKIE, `${EXPIRED_PREFIX}${supabaseUserId}`);

    const response = await requestCandidates(client, jobId);

    expect(response.status).toBe(200);
    expect(client.cookies.get(FAKE_SESSION_COOKIE)).toBe(fake.sessionCookieFor(supabaseUserId));
  });

  it('does not touch Supabase for requests without Supabase cookies', async () => {
    useKakao();

    const client = createApiTestClient();
    const before = fake.clientCount();

    await uploadAndProcess(client);

    expect(fake.clientCount()).toBe(before);
  });

  it('logs out through Supabase signOut and clears the session cookies', async () => {
    useKakao();

    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);

    fake.registerCode('code-logout', { id: randomUUID() });
    await kakaoLogin(client, 'code-logout', `/recognitions/${jobId}`);

    const signOutsBefore = fake.calls.signOut;
    const response = await client.send(logoutRoute, '/auth/logout?returnTo=/calendar', { method: 'POST' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/calendar`);
    expect(fake.calls.signOut).toBe(signOutsBefore + 1);
    expect(client.cookies.has(FAKE_SESSION_COOKIE)).toBe(false);
    expect((await requestCandidates(client, jobId)).status).toBe(401);
  });

  it('replaces a demo session when logging in with Kakao in demo mode', async () => {
    envSandbox.set({ APP_MODE: 'demo', ...SUPABASE_KAKAO_ENV });

    const client = createApiTestClient();

    await devLogin(client, '데모 사용자');
    expect(client.cookies.has('offnal_session')).toBe(true);

    fake.registerCode('code-demo', { id: randomUUID() });
    await kakaoLogin(client, 'code-demo', '/');

    expect(client.cookies.has('offnal_session')).toBe(false);
    expect(client.cookies.has(FAKE_SESSION_COOKIE)).toBe(true);
  });
});

describe('demo logout', () => {
  it('deletes the demo session', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '로그아웃 사용자');
    const response = await client.send(logoutRoute, '/auth/logout', { method: 'POST' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/`);
    expect(client.cookies.has('offnal_session')).toBe(false);
    expect((await requestCandidates(client, jobId)).status).toBe(401);
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

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as callbackRoute } from '@/app/auth/callback/route';
import { GET as loginRoute } from '@/app/auth/login/route';
import { POST as logoutRoute } from '@/app/auth/logout/route';
import { setDbForTesting } from '@/server/db/Database';
import { users } from '@/server/db/Schema';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import {
  findJobOwner,
  findSupabaseIdentities,
  kakaoLogin,
  OPEN_REDIRECT_PROBES,
  requestCandidates,
} from '../helpers/AuthFlows';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import {
  createFakeSupabase,
  EXPIRED_PREFIX,
  FAKE_SESSION_COOKIE,
  FAKE_SUPABASE_URL,
  FAKE_VERIFIER_COOKIE,
  SUPABASE_KAKAO_ENV,
} from '../helpers/FakeSupabase';
import { devLogin, uploadAndProcess } from '../helpers/OffnalFlows';

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

const useKakao = (overrides: Record<string, string | undefined> = {}): void => {
  envSandbox.set({ APP_MODE: 'live', ...SUPABASE_KAKAO_ENV, ...overrides });
};

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
    const [identity] = await findSupabaseIdentities(env.db, supabaseUserId);
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
    expect(await findJobOwner(env.db, jobId)).toBe(user?.id);
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
    expect(await findJobOwner(env.db, jobId)).toBeNull();
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

    const identities = await findSupabaseIdentities(env.db, supabaseUserId);
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

  it('keeps refreshed Supabase cookies on error responses', async () => {
    useKakao();

    const client = createApiTestClient();
    const supabaseUserId = randomUUID();

    fake.registerCode('code-error-refresh', { id: supabaseUserId });
    await kakaoLogin(client, 'code-error-refresh', '/');
    client.cookies.set(FAKE_SESSION_COOKIE, `${EXPIRED_PREFIX}${supabaseUserId}`);

    // Unknown job → the handler throws ApiError(NOT_FOUND) after the session was refreshed.
    const response = await requestCandidates(client, randomUUID());

    expect(response.status).toBe(404);
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) =>
          cookie.startsWith(`${FAKE_SESSION_COOKIE}=${fake.sessionCookieFor(supabaseUserId)}`),
        ),
    ).toBe(true);
    expect(client.cookies.get(FAKE_SESSION_COOKIE)).toBe(fake.sessionCookieFor(supabaseUserId));
  });

  it('does not verify the old Supabase session during the callback', async () => {
    useKakao();

    const client = createApiTestClient();

    fake.registerCode('code-old', { id: randomUUID() });
    await kakaoLogin(client, 'code-old', '/');
    fake.registerCode('code-new', { id: randomUUID() });
    await client.send(loginRoute, '/auth/login?provider=kakao&returnTo=%2F');

    const claimsBefore = fake.calls.getClaims;
    const response = await client.send(callbackRoute, '/auth/callback?code=code-new&returnTo=%2F');

    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/`);
    expect(fake.calls.getClaims).toBe(claimsBefore);
  });

  it('signs out and drops every Supabase cookie when linking fails after a successful exchange', async () => {
    useKakao();

    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);
    const failingDb = new Proxy(env.db, {
      get: (target, property, receiver) =>
        property === 'transaction'
          ? async () => {
              throw new Error('database unavailable');
            }
          : Reflect.get(target, property, receiver),
    });

    fake.registerCode('code-db-failure', { id: randomUUID() });
    await client.send(
      loginRoute,
      `/auth/login?provider=kakao&returnTo=${encodeURIComponent(`/recognitions/${jobId}`)}`,
    );
    expect(client.cookies.has(FAKE_VERIFIER_COOKIE)).toBe(true);

    const signOutsBefore = fake.calls.signOut;
    const staleVerifier = 'sb-test-ref-auth-token-flow-stale-code-verifier';

    // Leftovers from an earlier session in this browser must not survive the failed login either.
    client.cookies.set(FAKE_SESSION_COOKIE, fake.sessionCookieFor(randomUUID()));
    client.cookies.set(staleVerifier, 'stale');
    setDbForTesting(failingDb);

    try {
      const response = await client.send(
        callbackRoute,
        `/auth/callback?code=code-db-failure&returnTo=${encodeURIComponent(`/recognitions/${jobId}`)}`,
      );

      expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/${jobId}?login=failed`);
    } finally {
      setDbForTesting(env.db);
    }

    expect(fake.calls.signOut).toBe(signOutsBefore + 1);
    expect(client.cookies.has(FAKE_SESSION_COOKIE)).toBe(false);
    expect(client.cookies.has(FAKE_VERIFIER_COOKIE)).toBe(false);
    expect(client.cookies.has(staleVerifier)).toBe(false);
    expect(await findJobOwner(env.db, jobId)).toBeNull();
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

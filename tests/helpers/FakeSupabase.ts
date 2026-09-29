import { randomUUID } from 'node:crypto';

import { AuthError, type SignInWithOAuthCredentials, type User } from '@supabase/supabase-js';

import {
  type SupabaseAuthApi,
  type SupabaseClientFactory,
  type SupabaseCookieMethods,
  setSupabaseClientFactoryForTesting,
} from '@/server/auth/SupabaseServerClient';

export const FAKE_SUPABASE_URL = 'https://test-ref.supabase.co';
export const FAKE_SESSION_COOKIE = 'sb-test-ref-auth-token';
export const FAKE_VERIFIER_COOKIE = 'sb-test-ref-auth-token-code-verifier';

/** Env that enables Kakao login through the (fake) Supabase project. */
export const SUPABASE_KAKAO_ENV: Record<string, string> = {
  AUTH_PROVIDERS: 'kakao',
  NEXT_PUBLIC_SUPABASE_URL: FAKE_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

const VALID_PREFIX = 'valid.';

/** A session whose access token expired: getClaims refreshes it (writes a new cookie) before verifying. */
export const EXPIRED_PREFIX = 'expired.';

export type FakeSupabaseUser = {
  id: string;
  email?: string;
  nickname?: string;
};

export type FakeSupabaseCalls = {
  signInWithOAuth: SignInWithOAuthCredentials[];
  exchangeCodeForSession: string[];
  getClaims: number;
  signOut: number;
};

export type FakeSupabase = {
  calls: FakeSupabaseCalls;
  /** Clients created by the factory (one per request). */
  clientCount: () => number;
  /** Makes `code` exchangeable for a session of `user`. */
  registerCode: (code: string, user: FakeSupabaseUser) => void;
  /** Cookie value of a valid (signed) session for `userId`. */
  sessionCookieFor: (userId: string) => string;
  install: () => void;
  uninstall: () => void;
};

const noCacheHeaders = { 'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0' };

const readCookie = async (cookies: SupabaseCookieMethods, name: string): Promise<string | undefined> =>
  (await cookies.getAll())?.find((cookie) => cookie.name === name)?.value;

const toUser = (user: FakeSupabaseUser): User =>
  ({
    id: user.id,
    aud: 'authenticated',
    email: user.email,
    app_metadata: { provider: 'kakao' },
    user_metadata: user.nickname ? { nickname: user.nickname, name: user.nickname } : {},
    created_at: new Date().toISOString(),
  }) as User;

/**
 * In-memory stand-in for the Supabase Auth API, wired through the same cookie adapter as the real
 * @supabase/ssr client: PKCE verifier and session cookies are written via `setAll`, sessions are
 * "signed" only when this fake issued them (anything else fails verification like a forged JWT).
 */
export const createFakeSupabase = (): FakeSupabase => {
  const calls: FakeSupabaseCalls = {
    signInWithOAuth: [],
    exchangeCodeForSession: [],
    getClaims: 0,
    signOut: 0,
  };
  const codes = new Map<string, FakeSupabaseUser>();
  let clients = 0;

  const factory: SupabaseClientFactory = (_settings, cookies): SupabaseAuthApi => {
    clients += 1;

    return {
      signInWithOAuth: async (credentials) => {
        calls.signInWithOAuth.push(credentials);
        await cookies.setAll(
          [{ name: FAKE_VERIFIER_COOKIE, value: randomUUID(), options: { path: '/', sameSite: 'lax' } }],
          noCacheHeaders,
        );

        const url = new URL('/auth/v1/authorize', FAKE_SUPABASE_URL);

        url.searchParams.set('provider', credentials.provider);
        url.searchParams.set('redirect_to', credentials.options?.redirectTo ?? '');

        return { data: { provider: credentials.provider, url: url.toString() }, error: null };
      },
      exchangeCodeForSession: async (code) => {
        calls.exchangeCodeForSession.push(code);

        const user = codes.get(code);
        const verifier = await readCookie(cookies, FAKE_VERIFIER_COOKIE);

        if (!user || !verifier) {
          return {
            data: { user: null, session: null },
            error: new AuthError('invalid flow state', 400, 'flow_state_not_found'),
          };
        }

        await cookies.setAll(
          [
            { name: FAKE_SESSION_COOKIE, value: `${VALID_PREFIX}${user.id}`, options: { path: '/' } },
            { name: FAKE_VERIFIER_COOKIE, value: '', options: { path: '/', maxAge: 0 } },
          ],
          noCacheHeaders,
        );

        return {
          data: {
            user: toUser(user),
            session: {
              access_token: `${VALID_PREFIX}${user.id}`,
              refresh_token: 'refresh',
              expires_in: 3600,
              token_type: 'bearer',
              user: toUser(user),
            },
          },
          error: null,
        };
      },
      getClaims: async (): ReturnType<SupabaseAuthApi['getClaims']> => {
        calls.getClaims += 1;

        let token = await readCookie(cookies, FAKE_SESSION_COOKIE);

        if (!token) {
          return { data: null, error: null };
        }

        if (token.startsWith(EXPIRED_PREFIX)) {
          token = `${VALID_PREFIX}${token.slice(EXPIRED_PREFIX.length)}`;
          await cookies.setAll(
            [{ name: FAKE_SESSION_COOKIE, value: token, options: { path: '/' } }],
            noCacheHeaders,
          );
        }

        if (!token.startsWith(VALID_PREFIX)) {
          return { data: null, error: new AuthError('invalid JWT: signature mismatch', 401, 'bad_jwt') };
        }

        const now = Math.floor(Date.now() / 1000);

        return {
          data: {
            claims: {
              iss: `${FAKE_SUPABASE_URL}/auth/v1`,
              sub: token.slice(VALID_PREFIX.length),
              aud: 'authenticated',
              exp: now + 3600,
              iat: now,
              role: 'authenticated',
              aal: 'aal1',
              session_id: 'session',
            },
            header: { alg: 'ES256', typ: 'JWT', kid: 'test-key' },
            signature: new Uint8Array(),
          },
          error: null,
        };
      },
      signOut: async () => {
        calls.signOut += 1;
        await cookies.setAll(
          [{ name: FAKE_SESSION_COOKIE, value: '', options: { path: '/', maxAge: 0 } }],
          {},
        );

        return { error: null };
      },
    };
  };

  return {
    calls,
    clientCount: () => clients,
    registerCode: (code, user) => {
      codes.set(code, user);
    },
    sessionCookieFor: (userId) => `${VALID_PREFIX}${userId}`,
    install: () => {
      setSupabaseClientFactoryForTesting(factory);
    },
    uninstall: () => {
      setSupabaseClientFactoryForTesting(null);
    },
  };
};

import 'server-only';

import { type CookieOptions, createServerClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

import { type AppConfig, getAppConfig } from '@/server/config/AppConfig';
import { isSecureAppUrl } from '@/server/http/SessionCookies';

/** Default @supabase/ssr cookie names are `sb-<project-ref>-auth-token` (+ `.0`, `.1` chunks, `-code-verifier`). */
export const SUPABASE_COOKIE_PREFIX = 'sb-';

type SupabaseAuth = SupabaseClient['auth'];

/**
 * The slice of `supabase.auth` the app uses. Tests inject a fake with the same shape
 * (`setSupabaseClientFactoryForTesting`); production uses the real @supabase/ssr client.
 */
export type SupabaseAuthApi = {
  signInWithOAuth: SupabaseAuth['signInWithOAuth'];
  exchangeCodeForSession: (code: string) => ReturnType<SupabaseAuth['exchangeCodeForSession']>;
  /** Verifies the access token signature (JWKS, cached) and refreshes an expiring session first. */
  getClaims: () => ReturnType<SupabaseAuth['getClaims']>;
  signOut: SupabaseAuth['signOut'];
};

export type SupabaseSettings = {
  url: string;
  publishableKey: string;
};

export type SupabaseCookie = { name: string; value: string };

export type SupabaseCookieToSet = SupabaseCookie & { options: CookieOptions };

/** Same contract as the @supabase/ssr `cookies` option (`getAll` + `setAll` with cache headers). */
export type SupabaseCookieMethods = {
  getAll: () => SupabaseCookie[] | Promise<SupabaseCookie[] | null> | null;
  setAll: (cookies: SupabaseCookieToSet[], headers: Record<string, string>) => void | Promise<void>;
};

export type SupabaseClientFactory = (
  settings: SupabaseSettings,
  cookies: SupabaseCookieMethods,
) => SupabaseAuthApi;

/** Supabase client bound to one API request; collects cookie writes for the outgoing response. */
export type SupabaseRouteClient = {
  auth: SupabaseAuthApi;
  /**
   * Writes every cookie (and cache header) Supabase set during this request onto `response`.
   * A plain Response is re-wrapped as a NextResponse only when there is something to write.
   */
  applyCookies: (response: Response) => Response;
  /**
   * Queues removal of every Supabase cookie this browser holds or this request wrote (session
   * chunks, PKCE code verifiers), so `applyCookies` leaves no Supabase auth state behind.
   */
  expireAllCookies: () => void;
};

/**
 * Real @supabase/ssr client. Cookies are HttpOnly (the app has no browser-side Supabase client) and
 * Secure when APP_URL is https; name, path, SameSite=Lax and lifetime stay the library defaults.
 */
const createRealClient: SupabaseClientFactory = (settings, cookies) =>
  createServerClient(settings.url, settings.publishableKey, {
    cookies,
    cookieOptions: { httpOnly: true, secure: isSecureAppUrl() },
  }).auth;

type SupabaseGlobal = typeof globalThis & { __offnalSupabaseFactory?: SupabaseClientFactory | null };

const supabaseGlobal = globalThis as SupabaseGlobal;

/** The @supabase/ssr factory, or the test override. */
export const getSupabaseClientFactory = (): SupabaseClientFactory =>
  supabaseGlobal.__offnalSupabaseFactory ?? createRealClient;

/** Replaces the client factory (null restores @supabase/ssr). Tests only. */
export const setSupabaseClientFactoryForTesting = (factory: SupabaseClientFactory | null): void => {
  supabaseGlobal.__offnalSupabaseFactory = factory;
};

export const getSupabaseSettings = (config: AppConfig = getAppConfig()): SupabaseSettings | null =>
  config.supabaseUrl && config.supabasePublishableKey
    ? { url: config.supabaseUrl, publishableKey: config.supabasePublishableKey }
    : null;

export const isSupabaseCookieName = (name: string): boolean => name.startsWith(SUPABASE_COOKIE_PREFIX);

export const hasSupabaseCookies = (cookies: SupabaseCookie[]): boolean =>
  cookies.some((cookie) => isSupabaseCookieName(cookie.name));

const EXPIRED_COOKIE_OPTIONS: CookieOptions = { path: '/', maxAge: 0 };

const isRemoval = (cookie: SupabaseCookieToSet): boolean =>
  cookie.value === '' || (cookie.options.maxAge !== undefined && cookie.options.maxAge <= 0);

/**
 * Server client for route handlers: reads `request.cookies` and never touches `next/headers`
 * (handlers are called directly in integration tests). Later reads in the same request see the
 * cookies Supabase just wrote (e.g. getClaims right after a refresh). Null when Supabase is not configured.
 */
export const createSupabaseRouteClient = (
  request: NextRequest,
  settings: SupabaseSettings | null = getSupabaseSettings(),
): SupabaseRouteClient | null => {
  if (!settings) {
    return null;
  }

  const pending = new Map<string, SupabaseCookieToSet>();
  const headers: Record<string, string> = {};

  const getAll = (): SupabaseCookie[] => {
    const current = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]));

    for (const cookie of pending.values()) {
      if (isRemoval(cookie)) {
        current.delete(cookie.name);
      } else {
        current.set(cookie.name, cookie.value);
      }
    }

    return [...current.entries()].map(([name, value]) => ({ name, value }));
  };

  const auth = getSupabaseClientFactory()(settings, {
    getAll,
    setAll: (cookies, cacheHeaders) => {
      for (const cookie of cookies) {
        pending.set(cookie.name, cookie);
      }

      Object.assign(headers, cacheHeaders);
    },
  });

  return {
    auth,
    expireAllCookies: () => {
      const names = new Set([...request.cookies.getAll().map((cookie) => cookie.name), ...pending.keys()]);

      for (const name of names) {
        if (isSupabaseCookieName(name)) {
          pending.set(name, { name, value: '', options: { ...EXPIRED_COOKIE_OPTIONS } });
        }
      }
    },
    applyCookies: (response) => {
      if (pending.size === 0) {
        return response;
      }

      const target =
        response instanceof NextResponse
          ? response
          : new NextResponse(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });

      for (const cookie of pending.values()) {
        target.cookies.set(cookie.name, cookie.value, cookie.options);
      }

      for (const [key, value] of Object.entries(headers)) {
        target.headers.set(key, value);
      }

      return target;
    },
  };
};

/**
 * Server component client (`next/headers` cookies). Server components cannot set cookies, so
 * writes are ignored as the Supabase docs describe; `src/proxy.ts` refreshes the session beforehand.
 */
export const createSupabaseServerComponentClient = async (
  settings: SupabaseSettings | null = getSupabaseSettings(),
): Promise<SupabaseAuthApi | null> => {
  if (!settings) {
    return null;
  }

  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();

  return getSupabaseClientFactory()(settings, {
    getAll: () => cookieStore.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (cookiesToSet) => {
      try {
        for (const cookie of cookiesToSet) {
          cookieStore.set(cookie.name, cookie.value, cookie.options);
        }
      } catch {
        // Called from a server component: the proxy already refreshed the session cookies.
      }
    },
  });
};

/** Verified Supabase user ID (`sub`) or null. Invalid/forged/expired-and-unrefreshable tokens → null. */
export const readVerifiedSupabaseUserId = async (auth: SupabaseAuthApi): Promise<string | null> => {
  try {
    const { data, error } = await auth.getClaims();

    if (error || !data) {
      return null;
    }

    return typeof data.claims.sub === 'string' && data.claims.sub.length > 0 ? data.claims.sub : null;
  } catch {
    return null;
  }
};

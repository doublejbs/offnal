import { type NextRequest, NextResponse } from 'next/server';

import { destroySessionToken } from '@/server/auth/SessionService';
import { hasSupabaseCookies, isSupabaseCookieName } from '@/server/auth/SupabaseServerClient';
import { getDb } from '@/server/db/Database';
import { getRequestSession } from '@/server/http/RequestContext';
import {
  assertSameOrigin,
  buildAppUrl,
  NO_STORE,
  sanitizeReturnTo,
  withRoute,
} from '@/server/http/RouteHelpers';
import { clearCookie, clearSessionCookie } from '@/server/http/SessionCookies';

export const runtime = 'nodejs';

/**
 * POST /auth/logout?returnTo=/ → Supabase `signOut({ scope: 'local' })` (this browser only; other
 * devices stay signed in) on the request's Supabase client, demo session deletion, then clears
 * every session cookie and 303s to `returnTo`.
 */
export const POST = withRoute(async (request: NextRequest) => {
  assertSameOrigin(request);

  const db = await getDb();
  const { context, supabase } = await getRequestSession(request, db);

  if (context.sessionToken) {
    await destroySessionToken(db, context.sessionToken);
  }

  if (supabase) {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });

      if (error) {
        console.warn('[auth] supabase sign-out failed', { code: error.code });
      }
    } catch (error: unknown) {
      console.warn('[auth] supabase sign-out failed', {
        name: error instanceof Error ? error.name : typeof error,
      });
    }

    // Whatever signOut managed to do, no Supabase auth cookie survives logout in this browser.
    supabase.expireAllCookies();
  }

  const redirect = NextResponse.redirect(
    buildAppUrl(sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'))),
    303,
  );

  clearSessionCookie(redirect);

  // Kakao disabled (no Supabase client for this request) but stale Supabase cookies remain: drop them too.
  if (!supabase && hasSupabaseCookies(request.cookies.getAll())) {
    for (const cookie of request.cookies.getAll()) {
      if (isSupabaseCookieName(cookie.name)) {
        clearCookie(redirect, cookie.name);
      }
    }
  }

  const response = supabase ? supabase.applyCookies(redirect) : redirect;

  response.headers.set('Cache-Control', NO_STORE);

  return response;
});

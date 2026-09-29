import { type NextRequest, NextResponse } from 'next/server';

import { destroySessionToken } from '@/server/auth/SessionService';
import { createSupabaseRouteClient, isSupabaseCookieName } from '@/server/auth/SupabaseServerClient';
import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import {
  assertSameOrigin,
  buildAppUrl,
  NO_STORE,
  sanitizeReturnTo,
  withRoute,
} from '@/server/http/RouteHelpers';
import { clearCookie, clearSessionCookie } from '@/server/http/SessionCookies';

export const runtime = 'nodejs';

/** Revokes this browser's Supabase session (scope `local`: other devices stay signed in). */
const signOutOfSupabase = async (
  request: NextRequest,
): Promise<((response: Response) => Response) | null> => {
  const supabase = request.cookies.getAll().some((cookie) => isSupabaseCookieName(cookie.name))
    ? createSupabaseRouteClient(request)
    : null;

  if (!supabase) {
    return null;
  }

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

  return supabase.applyCookies;
};

/**
 * POST /auth/logout?returnTo=/ → Supabase signOut (when a Supabase session exists) and demo session
 * deletion, clears both kinds of cookies, 303 to `returnTo`.
 */
export const POST = withRoute(async (request: NextRequest) => {
  assertSameOrigin(request);

  const db = await getDb();
  const context = await getRequestContext(request, db);

  if (context.sessionToken) {
    await destroySessionToken(db, context.sessionToken);
  }

  const applySupabaseCookies = await signOutOfSupabase(request);
  const redirect = NextResponse.redirect(
    buildAppUrl(sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'))),
    303,
  );

  clearSessionCookie(redirect);

  // Whatever signOut managed to do, no Supabase auth cookie survives logout in this browser.
  for (const cookie of request.cookies.getAll()) {
    if (isSupabaseCookieName(cookie.name)) {
      clearCookie(redirect, cookie.name);
    }
  }

  const response = applySupabaseCookies ? applySupabaseCookies(redirect) : redirect;

  response.headers.set('Cache-Control', NO_STORE);

  return response;
});

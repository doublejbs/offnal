import { type NextRequest, NextResponse } from 'next/server';

import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { getKakaoLogin } from '@/server/auth/AuthProviderRegistry';
import { RETURN_TO_PARAM, SupabaseAuthFailure } from '@/server/auth/KakaoAuthProvider';
import { completeSupabaseLogin } from '@/server/auth/LoginService';
import { type SupabaseRouteClient } from '@/server/auth/SupabaseServerClient';
import { getDb } from '@/server/db/Database';
import { getPreLoginContext } from '@/server/http/RequestContext';
import {
  buildAppUrl,
  buildLoginFailedRedirect,
  NO_STORE,
  sanitizeReturnTo,
  withRedirectRoute,
} from '@/server/http/RouteHelpers';
import { clearSessionCookie } from '@/server/http/SessionCookies';

export const runtime = 'nodejs';

const readReturnTo = (request: NextRequest): string =>
  sanitizeReturnTo(request.nextUrl.searchParams.get(RETURN_TO_PARAM));

const describeError = (error: unknown): Record<string, string | undefined> => ({
  name: error instanceof Error ? error.name : typeof error,
  code: error instanceof SupabaseAuthFailure ? error.code : undefined,
});

/**
 * The exchange succeeded but linking the app user failed: revoke that fresh Supabase session and
 * drop every Supabase cookie (session, code verifier) so no half-finished login remains.
 */
const abandonSupabaseSession = async (supabase: SupabaseRouteClient): Promise<void> => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error: unknown) {
    console.warn('[auth] sign-out after failed login failed', describeError(error));
  }

  supabase.expireAllCookies();
};

/**
 * Supabase OAuth return (`redirectTo` = /auth/callback?returnTo=...): exchange the PKCE code for a
 * Supabase session, link the app user and claim the anonymous jobs, then go to `returnTo` with the
 * Supabase session cookies. No `offnal_session` is issued. Cancel/failure keeps the recognition job
 * and returns to `returnTo?login=failed` without a Supabase session.
 */
export const GET = withRedirectRoute(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const returnTo = readReturnTo(request);
  const code = searchParams.get('code');

  if (searchParams.has('error') || !code) {
    console.warn('[auth] login cancelled or rejected', {
      error: searchParams.get('error_code') ?? searchParams.get('error'),
    });

    return buildLoginFailedRedirect(returnTo, 302);
  }

  const { provider, supabase } = getKakaoLogin(AuthProviderType.KAKAO, request);
  let exchanged = false;

  try {
    const db = await getDb();
    const context = await getPreLoginContext(request, db);
    const profile = await provider.exchangeCode(code);

    exchanged = true;
    await completeSupabaseLogin(db, context, profile);

    const redirect = NextResponse.redirect(buildAppUrl(returnTo), 302);

    // The Supabase session replaces a previous demo session (deleted in the same transaction).
    if (context.sessionToken) {
      clearSessionCookie(redirect);
    }

    const response = supabase.applyCookies(redirect);

    response.headers.set('Cache-Control', NO_STORE);

    return response;
  } catch (error: unknown) {
    console.warn('[auth] login completion failed', describeError(error));

    if (exchanged) {
      await abandonSupabaseSession(supabase);
    }

    return supabase.applyCookies(buildLoginFailedRedirect(returnTo, 302));
  }
}, readReturnTo);

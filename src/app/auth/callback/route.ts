import { type NextRequest, NextResponse } from 'next/server';

import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { getKakaoLogin } from '@/server/auth/AuthProviderRegistry';
import { RETURN_TO_PARAM } from '@/server/auth/KakaoAuthProvider';
import { completeSupabaseLogin } from '@/server/auth/LoginService';
import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
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

/**
 * Supabase OAuth return (`redirectTo` = /auth/callback?returnTo=...): exchange the PKCE code for a
 * Supabase session, link the app user and claim the anonymous jobs, then go to `returnTo` with the
 * Supabase session cookies. No `offnal_session` is issued. Cancel/failure keeps the recognition job
 * and returns to `returnTo?login=failed` without session cookies.
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

  try {
    const profile = await provider.exchangeCode(code);
    const db = await getDb();
    const context = await getRequestContext(request, db);

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
    console.warn('[auth] login completion failed', {
      name: error instanceof Error ? error.name : typeof error,
      code: (error as { code?: unknown } | null)?.code,
    });

    // Session cookies from a successful exchange are deliberately dropped: no half-finished login.
    return buildLoginFailedRedirect(returnTo, 302);
  }
}, readReturnTo);

import { type NextRequest, NextResponse } from 'next/server';

import { type AuthProfile } from '@/server/auth/AuthProvider';
import { getOAuthProvider } from '@/server/auth/AuthProviderRegistry';
import { completeLogin } from '@/server/auth/LoginService';
import { clearOAuthStateCookie, readOAuthStateCookie } from '@/server/auth/OAuthStateCookie';
import { isEqualConstantTime } from '@/server/crypto/TokenCrypto';
import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { buildLoginFailedUrl, NO_STORE, sanitizeReturnTo, withRoute } from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

const redirectToFailure = (returnTo: string): NextResponse => {
  const response = NextResponse.redirect(buildLoginFailedUrl(returnTo), 302);

  clearOAuthStateCookie(response);
  response.headers.set('Cache-Control', NO_STORE);

  return response;
};

/** OAuth return. Cancel/failure keeps the recognition job and returns to `returnTo?login=failed`. */
export const GET = withRoute(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const stored = readOAuthStateCookie(request);
  const returnTo = sanitizeReturnTo(stored?.returnTo);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!stored || searchParams.has('error') || !code || !state || !isEqualConstantTime(state, stored.state)) {
    return redirectToFailure(returnTo);
  }

  let profile: AuthProfile;

  try {
    profile = await getOAuthProvider(stored.provider).exchangeCode(code, stored.codeVerifier);
  } catch (error: unknown) {
    console.warn('[auth] code exchange failed', { name: error instanceof Error ? error.name : typeof error });

    return redirectToFailure(returnTo);
  }

  const db = await getDb();
  const context = await getRequestContext(request, db);
  const response = await completeLogin(db, context, profile, returnTo, 302);

  clearOAuthStateCookie(response);

  return response;
});

import { type NextRequest, NextResponse } from 'next/server';

import { getOAuthProvider } from '@/server/auth/AuthProviderRegistry';
import { completeLogin } from '@/server/auth/LoginService';
import { isEqualConstantTime } from '@/server/crypto/TokenCrypto';
import { getDb } from '@/server/db/Database';
import { buildLoginRedirect } from '@/server/http/LoginResponses';
import { clearOAuthStateCookie, readOAuthStateCookie } from '@/server/http/OAuthStateCookie';
import { getRequestContext } from '@/server/http/RequestContext';
import {
  buildLoginFailedUrl,
  NO_STORE,
  sanitizeReturnTo,
  withRedirectRoute,
} from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

const readReturnTo = (request: NextRequest): string =>
  sanitizeReturnTo(readOAuthStateCookie(request)?.returnTo);

const redirectToFailure = (returnTo: string): NextResponse => {
  const response = NextResponse.redirect(buildLoginFailedUrl(returnTo), 302);

  clearOAuthStateCookie(response);
  response.headers.set('Cache-Control', NO_STORE);

  return response;
};

/** OAuth return. Cancel/failure keeps the recognition job and returns to `returnTo?login=failed`. */
export const GET = withRedirectRoute(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const stored = readOAuthStateCookie(request);
  const returnTo = readReturnTo(request);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!stored || searchParams.has('error') || !code || !state || !isEqualConstantTime(state, stored.state)) {
    return redirectToFailure(returnTo);
  }

  try {
    const profile = await getOAuthProvider(stored.provider).exchangeCode(code, stored.codeVerifier);
    const db = await getDb();
    const result = await completeLogin(db, await getRequestContext(request, db), profile);
    const response = buildLoginRedirect(result, returnTo, 302);

    clearOAuthStateCookie(response);

    return response;
  } catch (error: unknown) {
    console.warn('[auth] login completion failed', {
      name: error instanceof Error ? error.name : typeof error,
    });

    return redirectToFailure(returnTo);
  }
}, readReturnTo);

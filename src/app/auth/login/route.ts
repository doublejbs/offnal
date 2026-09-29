import { type NextRequest, NextResponse } from 'next/server';

import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { getOAuthProvider } from '@/server/auth/AuthProviderRegistry';
import { generateToken } from '@/server/crypto/TokenCrypto';
import { setOAuthStateCookie } from '@/server/http/OAuthStateCookie';
import { NO_STORE, sanitizeReturnTo, withRedirectRoute } from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

const readReturnTo = (request: NextRequest): string =>
  sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'));

/**
 * GET /auth/login?provider=google&returnTo=/recognitions/:id → provider consent screen (state + PKCE).
 * Unknown or unconfigured providers redirect back with `login=failed` (never JSON to the browser).
 */
export const GET = withRedirectRoute(async (request: NextRequest) => {
  const provider = getOAuthProvider(request.nextUrl.searchParams.get('provider') ?? AuthProviderType.GOOGLE);
  const returnTo = readReturnTo(request);
  const state = generateToken();
  // 32 random bytes in base64url = 43 unreserved characters, a valid PKCE code verifier.
  const codeVerifier = generateToken();
  const response = NextResponse.redirect(provider.createAuthorizationUrl(state, codeVerifier), 302);

  setOAuthStateCookie(response, { provider: provider.kind, state, codeVerifier, returnTo });
  response.headers.set('Cache-Control', NO_STORE);

  return response;
}, readReturnTo);

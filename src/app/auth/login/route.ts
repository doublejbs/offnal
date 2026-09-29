import { type NextRequest, NextResponse } from 'next/server';

import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { getOAuthProvider } from '@/server/auth/AuthProviderRegistry';
import { setOAuthStateCookie } from '@/server/auth/OAuthStateCookie';
import { generateToken } from '@/server/crypto/TokenCrypto';
import { NO_STORE, sanitizeReturnTo, withRoute } from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

/** GET /auth/login?provider=google&returnTo=/recognitions/:id → provider consent screen (state + PKCE). */
export const GET = withRoute(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const provider = getOAuthProvider(searchParams.get('provider') ?? AuthProviderType.GOOGLE);
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));
  const state = generateToken();
  // 32 random bytes in base64url = 43 unreserved characters, a valid PKCE code verifier.
  const codeVerifier = generateToken();
  const response = NextResponse.redirect(provider.createAuthorizationUrl(state, codeVerifier), 302);

  setOAuthStateCookie(response, { provider: provider.kind, state, codeVerifier, returnTo });
  response.headers.set('Cache-Control', NO_STORE);

  return response;
});

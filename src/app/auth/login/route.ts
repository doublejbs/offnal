import { type NextRequest, NextResponse } from 'next/server';

import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { getKakaoLogin } from '@/server/auth/AuthProviderRegistry';
import { NO_STORE, sanitizeReturnTo, withRedirectRoute } from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

const readReturnTo = (request: NextRequest): string =>
  sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'));

/**
 * GET /auth/login?provider=kakao&returnTo=/recognitions/:id → Supabase Auth → Kakao consent screen.
 * Supabase writes the PKCE code verifier cookie, which is carried on this redirect.
 * Unknown or unconfigured providers redirect back with `login=failed` (never JSON to the browser).
 */
export const GET = withRedirectRoute(async (request: NextRequest) => {
  const { provider, supabase } = getKakaoLogin(
    request.nextUrl.searchParams.get('provider') ?? AuthProviderType.KAKAO,
    request,
  );
  const authorizationUrl = await provider.createAuthorizationUrl(readReturnTo(request));
  const response = supabase.applyCookies(NextResponse.redirect(authorizationUrl, 302));

  response.headers.set('Cache-Control', NO_STORE);

  return response;
}, readReturnTo);

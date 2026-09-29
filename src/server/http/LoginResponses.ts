import { NextResponse } from 'next/server';

import { type LoginResult } from '@/server/auth/LoginService';
import { buildAppUrl, NO_STORE } from '@/server/http/RouteHelpers';
import { setSessionCookie } from '@/server/http/SessionCookies';

/** Redirect to the (already sanitized) returnTo with the new session cookie. */
export const buildLoginRedirect = (result: LoginResult, returnTo: string, status: number): NextResponse => {
  const response = NextResponse.redirect(buildAppUrl(returnTo), status);

  setSessionCookie(response, result.session);
  response.headers.set('Cache-Control', NO_STORE);

  return response;
};

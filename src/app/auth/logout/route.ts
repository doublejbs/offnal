import { type NextRequest, NextResponse } from 'next/server';

import { clearSessionCookie, destroySessionToken } from '@/server/auth/SessionService';
import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import {
  assertSameOrigin,
  buildAppUrl,
  NO_STORE,
  sanitizeReturnTo,
  withRoute,
} from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

/** POST /auth/logout?returnTo=/ → deletes the DB session, clears the cookie, 303 to `returnTo`. */
export const POST = withRoute(async (request: NextRequest) => {
  assertSameOrigin(request);

  const db = await getDb();
  const context = await getRequestContext(request, db);

  if (context.sessionToken) {
    await destroySessionToken(db, context.sessionToken);
  }

  const response = NextResponse.redirect(
    buildAppUrl(sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'))),
    303,
  );

  clearSessionCookie(response);
  response.headers.set('Cache-Control', NO_STORE);

  return response;
});

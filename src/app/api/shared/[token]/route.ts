import { type NextRequest } from 'next/server';

import { hashIp } from '@/server/auth/SessionService';
import { getDb } from '@/server/db/Database';
import { type ParamsRouteContext, type TokenParams } from '@/server/http/ApiRoute';
import { getClientIpFromHeaders } from '@/server/http/ClientIp';
import { withPublicShareHeaders } from '@/server/http/PublicShareHeaders';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { getSharedCalendar } from '@/server/services/SharedCalendarService';

export const runtime = 'nodejs';

/** Public, read-only, cookie-free. Every response (errors included) carries the share headers. */
export const GET = withPublicShareHeaders(
  withRoute(async (request: NextRequest, routeContext: ParamsRouteContext<TokenParams>) => {
    const { token } = await routeContext.params;
    const db = await getDb();

    await enforceSharedViewLimit(db, hashIp(getClientIpFromHeaders(request.headers)));

    return jsonResponse(await getSharedCalendar(db, token, request.nextUrl.searchParams.get('month')));
  }),
);

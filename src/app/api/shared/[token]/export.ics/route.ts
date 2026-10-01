import { type NextRequest } from 'next/server';

import { hashIp } from '@/server/auth/SessionService';
import { getDb } from '@/server/db/Database';
import { type ParamsRouteContext, type TokenParams } from '@/server/http/ApiRoute';
import { getClientIpFromHeaders } from '@/server/http/ClientIp';
import { withPublicShareHeaders } from '@/server/http/PublicShareHeaders';
import { icsResponse, parseIcsDisposition, parseIncludeOff, withRoute } from '@/server/http/RouteHelpers';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { exportSharedMonthIcs } from '@/server/services/SharedCalendarService';

export const runtime = 'nodejs';

/** Public one-time ICS of a shared month. Same share headers and IP limit as GET /api/shared/:token. */
export const GET = withPublicShareHeaders(
  withRoute(async (request: NextRequest, routeContext: ParamsRouteContext<TokenParams>) => {
    const { token } = await routeContext.params;
    const { searchParams } = request.nextUrl;
    const db = await getDb();

    await enforceSharedViewLimit(db, hashIp(getClientIpFromHeaders(request.headers)));

    const { fileName, body } = await exportSharedMonthIcs(
      db,
      token,
      searchParams.get('month'),
      parseIncludeOff(searchParams),
    );

    return icsResponse(fileName, body, parseIcsDisposition(searchParams));
  }),
);

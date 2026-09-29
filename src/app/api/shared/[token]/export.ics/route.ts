import { type NextRequest, NextResponse } from 'next/server';

import { hashIp } from '@/server/auth/SessionService';
import { getDb } from '@/server/db/Database';
import { type ParamsRouteContext, type TokenParams } from '@/server/http/ApiRoute';
import { getClientIpFromHeaders } from '@/server/http/ClientIp';
import { withPublicShareHeaders } from '@/server/http/PublicShareHeaders';
import { withRoute } from '@/server/http/RouteHelpers';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { exportSharedMonthIcs } from '@/server/services/ShareService';

export const runtime = 'nodejs';

const INCLUDE_OFF_VALUES = new Set(['1', 'true']);

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
      INCLUDE_OFF_VALUES.has(searchParams.get('includeOff') ?? ''),
    );

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  }),
);

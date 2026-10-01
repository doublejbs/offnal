import { type NextRequest } from 'next/server';

import { ContentDisposition } from '@/domain/enums/ContentDisposition';
import { hashIp } from '@/server/auth/SessionService';
import { getDb } from '@/server/db/Database';
import { type ParamsRouteContext, type TokenParams } from '@/server/http/ApiRoute';
import { getClientIpFromHeaders } from '@/server/http/ClientIp';
import { withPublicShareHeaders } from '@/server/http/PublicShareHeaders';
import {
  icsResponse,
  parseIcsDisposition,
  parseIncludeOff,
  toErrorResponse,
} from '@/server/http/RouteHelpers';
import { buildSharedIcsFailureRedirect, toSharedIcsNotice } from '@/server/http/SharedIcsRedirect';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { exportSharedMonthIcs } from '@/server/services/SharedCalendarService';

export const runtime = 'nodejs';

/**
 * Public one-time ICS of a shared month. Same share headers and IP limit as GET /api/shared/:token.
 * An inline (open=1) request is an iOS navigation: expired/limited failures redirect to the page.
 */
export const GET = withPublicShareHeaders(
  async (request: NextRequest, routeContext: ParamsRouteContext<TokenParams>): Promise<Response> => {
    const { token } = await routeContext.params;
    const { searchParams } = request.nextUrl;
    const disposition = parseIcsDisposition(searchParams);
    const month = searchParams.get('month');

    try {
      const db = await getDb();

      await enforceSharedViewLimit(db, hashIp(getClientIpFromHeaders(request.headers)));

      const { fileName, body } = await exportSharedMonthIcs(db, token, month, parseIncludeOff(searchParams));

      return icsResponse(fileName, body, disposition);
    } catch (error: unknown) {
      const notice = disposition === ContentDisposition.INLINE ? toSharedIcsNotice(error) : null;

      if (notice) {
        return buildSharedIcsFailureRedirect(token, month, notice);
      }

      return toErrorResponse(request, error);
    }
  },
);

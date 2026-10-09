import { type TeamParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { getMyTeamMonths } from '@/server/services/TeamCalendarService';

export const runtime = 'nodejs';

/** TeamMyMonthsResponse (ACTIVE members). */
export const GET = teamApiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  getMyTeamMonths(db, context, params.id),
);

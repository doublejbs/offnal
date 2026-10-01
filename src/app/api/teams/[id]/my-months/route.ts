import { apiRoute, type TeamParams } from '@/server/http/ApiRoute';
import { getMyTeamMonths } from '@/server/services/TeamCalendarService';

export const runtime = 'nodejs';

/** TeamMyMonthsResponse (ACTIVE members). */
export const GET = apiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  getMyTeamMonths(db, context, params.id),
);

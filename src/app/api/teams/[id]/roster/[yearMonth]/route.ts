import { apiRoute, type TeamMonthParams } from '@/server/http/ApiRoute';
import { getTeamRosterView } from '@/server/services/TeamCalendarService';

export const runtime = 'nodejs';

/** TeamRosterViewResponse (ADMIN; ACTIVE members while the team shares the roster). */
export const GET = apiRoute<TeamMonthParams>({ mutating: false }, async ({ db, context, params }) =>
  getTeamRosterView(db, context, params.id, params.yearMonth),
);

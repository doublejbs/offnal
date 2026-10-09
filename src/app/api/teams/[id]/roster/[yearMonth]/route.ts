import { type TeamMonthParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { getTeamRosterView } from '@/server/services/TeamCalendarService';

export const runtime = 'nodejs';

/** TeamRosterViewResponse (ADMIN; ACTIVE members while the team shares the roster). */
export const GET = teamApiRoute<TeamMonthParams>({ mutating: false }, async ({ db, context, params }) =>
  getTeamRosterView(db, context, params.id, params.yearMonth),
);

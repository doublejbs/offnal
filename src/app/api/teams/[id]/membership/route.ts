import { apiRoute, type TeamParams } from '@/server/http/ApiRoute';
import { leaveTeam } from '@/server/services/TeamMembershipService';

export const runtime = 'nodejs';

/** OkResponse: leave the team (or withdraw a pending request). */
export const DELETE = apiRoute<TeamParams>({ mutating: true }, async ({ db, context, params }) =>
  leaveTeam(db, context, params.id),
);

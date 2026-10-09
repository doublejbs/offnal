import { type TeamParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { updateTeamRequestSchema } from '@/server/services/TeamRequestSchemas';
import { deleteTeam, getTeamDetail, updateTeam } from '@/server/services/TeamService';

export const runtime = 'nodejs';

/** TeamDetailResponse (ACTIVE members and admins). */
export const GET = teamApiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  getTeamDetail(db, context, params.id),
);

/** UpdateTeamRequest → TeamDetailResponse (ADMIN). */
export const PATCH = teamApiRoute<TeamParams>({ mutating: true }, async ({ request, db, context, params }) =>
  updateTeam(db, context, params.id, await parseJsonBody(request, updateTeamRequestSchema)),
);

/** OkResponse (ADMIN): deletes the team and everything in it, users stay. */
export const DELETE = teamApiRoute<TeamParams>({ mutating: true }, async ({ db, context, params }) =>
  deleteTeam(db, context, params.id),
);

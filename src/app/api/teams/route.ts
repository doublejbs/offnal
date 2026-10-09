import { type NoParams } from '@/server/http/ApiRoute';
import { jsonResponse, parseJsonBody } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { createTeamRequestSchema } from '@/server/services/TeamRequestSchemas';
import { createTeam, listMyTeams } from '@/server/services/TeamService';

export const runtime = 'nodejs';

/** TeamListResponse */
export const GET = teamApiRoute<NoParams>({ mutating: false }, async ({ db, context }) =>
  listMyTeams(db, context),
);

/** CreateTeamRequest → 201 TeamDetailResponse */
export const POST = teamApiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) =>
  jsonResponse(await createTeam(db, context, await parseJsonBody(request, createTeamRequestSchema)), 201),
);

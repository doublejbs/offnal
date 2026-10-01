import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { jsonResponse, parseJsonBody } from '@/server/http/RouteHelpers';
import { createTeamRequestSchema } from '@/server/services/TeamRequestSchemas';
import { createTeam, listMyTeams } from '@/server/services/TeamService';

export const runtime = 'nodejs';

/** TeamListResponse */
export const GET = apiRoute<NoParams>({ mutating: false }, async ({ db, context }) =>
  listMyTeams(db, context),
);

/** CreateTeamRequest → 201 TeamDetailResponse */
export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) =>
  jsonResponse(await createTeam(db, context, await parseJsonBody(request, createTeamRequestSchema)), 201),
);

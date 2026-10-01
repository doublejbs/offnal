import { apiRoute, type TokenParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { requestToJoin } from '@/server/services/TeamJoinService';
import { joinTeamRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** JoinTeamRequest → TeamMembershipSummary (PENDING; logged in). */
export const POST = apiRoute<TokenParams>({ mutating: true }, async ({ request, db, context, params }) =>
  requestToJoin(db, context, params.token, await parseJsonBody(request, joinTeamRequestSchema)),
);

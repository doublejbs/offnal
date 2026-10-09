import { type TokenParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { requestToJoin } from '@/server/services/TeamJoinService';
import { joinTeamRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** JoinTeamRequest → TeamMembershipSummary (PENDING; logged in). */
export const POST = teamApiRoute<TokenParams>({ mutating: true }, async ({ request, db, context, params }) =>
  requestToJoin(db, context, params.token, await parseJsonBody(request, joinTeamRequestSchema)),
);

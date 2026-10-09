import { type TeamParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { acknowledgeTeamChanges } from '@/server/services/TeamCalendarService';
import { ackTeamChangesRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** AckTeamChangesRequest → AckTeamChangesResponse (ACTIVE members). */
export const POST = teamApiRoute<TeamParams>({ mutating: true }, async ({ request, db, context, params }) =>
  acknowledgeTeamChanges(db, context, params.id, await parseJsonBody(request, ackTeamChangesRequestSchema)),
);

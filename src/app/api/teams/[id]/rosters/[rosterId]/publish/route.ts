import { apiRoute, type TeamRosterParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { publishTeamRoster } from '@/server/services/TeamRosterPublishService';
import { publishTeamRosterRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** PublishTeamRosterRequest → PublishTeamRosterResponse (ADMIN). 422 PUBLISH_BLOCKED, 409 REVISION_CONFLICT. */
export const POST = apiRoute<TeamRosterParams>(
  { mutating: true },
  async ({ request, db, context, params }) => {
    const body = await parseJsonBody(request, publishTeamRosterRequestSchema);

    return publishTeamRoster(db, context, params.id, params.rosterId, body);
  },
);

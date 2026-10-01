import { apiRoute, type TeamRosterParams } from '@/server/http/ApiRoute';
import { parseOptionalJsonBody } from '@/server/http/RouteHelpers';
import { revertTeamRosterRequestSchema } from '@/server/services/TeamRequestSchemas';
import { revertTeamRoster } from '@/server/services/TeamRosterRevisionService';

export const runtime = 'nodejs';

/** RevertTeamRosterRequest (optional body) → PublishTeamRosterResponse (ADMIN): republishes an ARCHIVED revision. */
export const POST = apiRoute<TeamRosterParams>({ mutating: true }, async ({ request, db, context, params }) =>
  revertTeamRoster(
    db,
    context,
    params.id,
    params.rosterId,
    await parseOptionalJsonBody(request, revertTeamRosterRequestSchema),
  ),
);

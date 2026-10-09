import { type TeamRosterParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { patchTeamRoster } from '@/server/services/TeamRosterEditService';
import { getTeamRoster } from '@/server/services/TeamRosterQueries';
import { patchTeamRosterRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** TeamRosterResponse (ADMIN). */
export const GET = teamApiRoute<TeamRosterParams>({ mutating: false }, async ({ db, context, params }) =>
  getTeamRoster(db, context, params.id, params.rosterId),
);

/** PatchTeamRosterRequest → TeamRosterResponse (ADMIN, DRAFT). 409 REVISION_CONFLICT on a stale version. */
export const PATCH = teamApiRoute<TeamRosterParams>(
  { mutating: true },
  async ({ request, db, context, params }) =>
    patchTeamRoster(
      db,
      context,
      params.id,
      params.rosterId,
      await parseJsonBody(request, patchTeamRosterRequestSchema),
    ),
);

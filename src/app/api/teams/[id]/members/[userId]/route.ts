import { apiRoute, type TeamMemberParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { removeMember, updateMember } from '@/server/services/TeamMembershipService';
import { updateTeamMemberRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** UpdateTeamMemberRequest → TeamMemberDto (ADMIN). */
export const PATCH = apiRoute<TeamMemberParams>(
  { mutating: true },
  async ({ request, db, context, params }) =>
    updateMember(
      db,
      context,
      params.id,
      params.userId,
      await parseJsonBody(request, updateTeamMemberRequestSchema),
    ),
);

/** OkResponse (ADMIN): removes a member or a pending request. */
export const DELETE = apiRoute<TeamMemberParams>({ mutating: true }, async ({ db, context, params }) =>
  removeMember(db, context, params.id, params.userId),
);

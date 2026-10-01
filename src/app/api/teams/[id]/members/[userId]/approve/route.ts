import { apiRoute, type TeamMemberParams } from '@/server/http/ApiRoute';
import { parseOptionalJsonBody } from '@/server/http/RouteHelpers';
import { approveMember } from '@/server/services/TeamMembershipService';
import { approveTeamMemberRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** ApproveTeamMemberRequest (optional body) → TeamMemberDto (ADMIN). */
export const POST = apiRoute<TeamMemberParams>({ mutating: true }, async ({ request, db, context, params }) =>
  approveMember(
    db,
    context,
    params.id,
    params.userId,
    await parseOptionalJsonBody(request, approveTeamMemberRequestSchema),
  ),
);

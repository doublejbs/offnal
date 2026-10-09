import { type TeamParams } from '@/server/http/ApiRoute';
import { jsonResponse, parseOptionalJsonBody } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { issueInvite, listInvites } from '@/server/services/TeamInviteService';
import { createTeamInviteRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';

/** TeamInviteListResponse (ADMIN). */
export const GET = teamApiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  listInvites(db, context, params.id),
);

/** CreateTeamInviteRequest (optional body) → 201 CreateTeamInviteResponse (ADMIN). */
export const POST = teamApiRoute<TeamParams>({ mutating: true }, async ({ request, db, context, params }) =>
  jsonResponse(
    await issueInvite(
      db,
      context,
      params.id,
      await parseOptionalJsonBody(request, createTeamInviteRequestSchema),
    ),
    201,
  ),
);

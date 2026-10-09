import { type TeamMemberParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { rejectMember } from '@/server/services/TeamMembershipService';

export const runtime = 'nodejs';

/** OkResponse (ADMIN): rejects a pending request. */
export const POST = teamApiRoute<TeamMemberParams>({ mutating: true }, async ({ db, context, params }) =>
  rejectMember(db, context, params.id, params.userId),
);

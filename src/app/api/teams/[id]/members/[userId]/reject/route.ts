import { apiRoute, type TeamMemberParams } from '@/server/http/ApiRoute';
import { rejectMember } from '@/server/services/TeamMembershipService';

export const runtime = 'nodejs';

/** OkResponse (ADMIN): rejects a pending request. */
export const POST = apiRoute<TeamMemberParams>({ mutating: true }, async ({ db, context, params }) =>
  rejectMember(db, context, params.id, params.userId),
);

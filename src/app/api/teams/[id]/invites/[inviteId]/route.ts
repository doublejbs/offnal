import { type TeamInviteParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { revokeInvite } from '@/server/services/TeamInviteService';

export const runtime = 'nodejs';

/** OkResponse (ADMIN): stops the invite link. */
export const DELETE = teamApiRoute<TeamInviteParams>({ mutating: true }, async ({ db, context, params }) =>
  revokeInvite(db, context, params.id, params.inviteId),
);

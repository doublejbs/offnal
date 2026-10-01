import { apiRoute, type TeamInviteParams } from '@/server/http/ApiRoute';
import { revokeInvite } from '@/server/services/TeamInviteService';

export const runtime = 'nodejs';

/** OkResponse (ADMIN): stops the invite link. */
export const DELETE = apiRoute<TeamInviteParams>({ mutating: true }, async ({ db, context, params }) =>
  revokeInvite(db, context, params.id, params.inviteId),
);

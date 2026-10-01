import { apiRoute, type TokenParams } from '@/server/http/ApiRoute';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { lookupInvite } from '@/server/services/TeamInviteService';

export const runtime = 'nodejs';

/** InviteLookupResponse — public; before login only `{ teamName }`. Same per-IP limit as share links. */
export const GET = apiRoute<TokenParams>({ mutating: false }, async ({ db, context, params }) => {
  await enforceSharedViewLimit(db, context.ipHash);

  return lookupInvite(db, context, params.token);
});

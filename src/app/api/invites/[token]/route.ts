import { type TokenParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { lookupInvite } from '@/server/services/TeamInviteService';

export const runtime = 'nodejs';

/** InviteLookupResponse — public; before login only `{ teamName }`. Same per-IP limit as share links. */
export const GET = teamApiRoute<TokenParams>({ mutating: false }, async ({ db, context, params }) => {
  await enforceSharedViewLimit(db, context.ipHash);

  return lookupInvite(db, context, params.token);
});

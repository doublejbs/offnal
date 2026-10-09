import { type TokenParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { listJoinableRows } from '@/server/services/TeamMemberQueries';

export const runtime = 'nodejs';

/** InviteRowsResponse (logged in; REMOVED users 404). Same per-IP limit as share links and invite lookups. */
export const GET = teamApiRoute<TokenParams>({ mutating: false }, async ({ db, context, params }) => {
  await enforceSharedViewLimit(db, context.ipHash);

  return listJoinableRows(db, context, params.token);
});

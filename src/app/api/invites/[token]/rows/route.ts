import { apiRoute, type TokenParams } from '@/server/http/ApiRoute';
import { enforceSharedViewLimit } from '@/server/services/RateLimitService';
import { listJoinableRows } from '@/server/services/TeamMemberQueries';

export const runtime = 'nodejs';

/** InviteRowsResponse (logged in; REMOVED users 404). Same per-IP limit as share links and invite lookups. */
export const GET = apiRoute<TokenParams>({ mutating: false }, async ({ db, context, params }) => {
  await enforceSharedViewLimit(db, context.ipHash);

  return listJoinableRows(db, context, params.token);
});

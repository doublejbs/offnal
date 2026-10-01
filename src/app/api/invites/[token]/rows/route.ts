import { apiRoute, type TokenParams } from '@/server/http/ApiRoute';
import { listJoinableRows } from '@/server/services/TeamMemberQueries';

export const runtime = 'nodejs';

/** InviteRowsResponse (logged in). */
export const GET = apiRoute<TokenParams>({ mutating: false }, async ({ db, context, params }) =>
  listJoinableRows(db, context, params.token),
);

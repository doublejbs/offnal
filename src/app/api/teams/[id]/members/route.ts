import { apiRoute, type TeamParams } from '@/server/http/ApiRoute';
import { listMembers } from '@/server/services/TeamMemberQueries';

export const runtime = 'nodejs';

/** TeamMemberListResponse (ADMIN). */
export const GET = apiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  listMembers(db, context, params.id),
);

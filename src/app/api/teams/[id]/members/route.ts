import { type TeamParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { listMembers } from '@/server/services/TeamMemberQueries';

export const runtime = 'nodejs';

/** TeamMemberListResponse (ADMIN). */
export const GET = teamApiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  listMembers(db, context, params.id),
);

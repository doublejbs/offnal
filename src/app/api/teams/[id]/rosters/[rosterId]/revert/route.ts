import { apiRoute, type TeamRosterParams } from '@/server/http/ApiRoute';
import { revertTeamRoster } from '@/server/services/TeamRosterRevisionService';

export const runtime = 'nodejs';

/** PublishTeamRosterResponse (ADMIN): republishes an ARCHIVED revision as a new revision. */
export const POST = apiRoute<TeamRosterParams>({ mutating: true }, async ({ db, context, params }) =>
  revertTeamRoster(db, context, params.id, params.rosterId),
);

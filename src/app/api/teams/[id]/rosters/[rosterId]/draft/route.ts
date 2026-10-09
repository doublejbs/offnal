import { type TeamRosterParams } from '@/server/http/ApiRoute';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { createRosterDraft } from '@/server/services/TeamRosterRevisionService';

export const runtime = 'nodejs';

/** CreateRosterDraftResponse (ADMIN): DRAFT copy of the PUBLISHED revision for direct edits. */
export const POST = teamApiRoute<TeamRosterParams>({ mutating: true }, async ({ db, context, params }) =>
  createRosterDraft(db, context, params.id, params.rosterId),
);

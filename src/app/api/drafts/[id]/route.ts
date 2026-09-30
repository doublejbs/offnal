import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { discardDraft, getDraft, patchDraft } from '@/server/services/DraftService';
import { patchDraftRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

export const GET = apiRoute<IdParams>({ mutating: false }, async ({ db, context, params }) =>
  getDraft(db, context, params.id),
);

export const PATCH = apiRoute<IdParams>({ mutating: true }, async ({ request, db, context, params }) =>
  patchDraft(db, context, params.id, await parseJsonBody(request, patchDraftRequestSchema)),
);

export const DELETE = apiRoute<IdParams>({ mutating: true }, async ({ db, context, params }) =>
  discardDraft(db, context, params.id),
);

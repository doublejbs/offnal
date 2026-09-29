import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { publishDraft } from '@/server/services/PublishService';
import { publishDraftRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

export const POST = apiRoute<IdParams>({ mutating: true }, async ({ request, db, context, params }) => {
  const { revision } = await parseJsonBody(request, publishDraftRequestSchema);

  return publishDraft(db, context, params.id, revision);
});

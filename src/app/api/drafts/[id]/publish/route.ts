import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, parseJsonBody, withRoute } from '@/server/http/RouteHelpers';
import { publishDraft } from '@/server/services/PublishService';
import { publishDraftRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

type IdRouteContext = { params: Promise<{ id: string }> };

export const POST = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  assertSameOrigin(request);

  const { id } = await params;
  const { revision } = await parseJsonBody(request, publishDraftRequestSchema);
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await publishDraft(db, context, id, revision));
});

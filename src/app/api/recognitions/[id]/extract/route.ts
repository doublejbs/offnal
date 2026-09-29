import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, parseJsonBody, withRoute } from '@/server/http/RouteHelpers';
import { extractDraft } from '@/server/services/RecognitionService';
import { extractRecognitionRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';
/** The second recognition pass runs synchronously. */
export const maxDuration = 300;

type IdRouteContext = { params: Promise<{ id: string }> };

export const POST = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  assertSameOrigin(request);

  const { id } = await params;
  const body = await parseJsonBody(request, extractRecognitionRequestSchema);
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await extractDraft(db, context, id, body));
});

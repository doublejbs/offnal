import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { claimRecognition } from '@/server/services/RecognitionService';

export const runtime = 'nodejs';

type IdRouteContext = { params: Promise<{ id: string }> };

export const POST = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  assertSameOrigin(request);

  const { id } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await claimRecognition(db, context, id));
});

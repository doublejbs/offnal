import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, parseJsonBody, withRoute } from '@/server/http/RouteHelpers';
import { discardDraft, getDraft, patchDraft } from '@/server/services/DraftService';
import { patchDraftRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

type IdRouteContext = { params: Promise<{ id: string }> };

export const GET = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  const { id } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await getDraft(db, context, id));
});

export const PATCH = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  assertSameOrigin(request);

  const { id } = await params;
  const body = await parseJsonBody(request, patchDraftRequestSchema);
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await patchDraft(db, context, id, body));
});

export const DELETE = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  assertSameOrigin(request);

  const { id } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await discardDraft(db, context, id));
});

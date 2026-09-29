import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { getCandidates } from '@/server/services/RecognitionService';

export const runtime = 'nodejs';

type IdRouteContext = { params: Promise<{ id: string }> };

export const GET = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  const { id } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await getCandidates(db, context, id));
});

import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { createEditDraftFromPublished } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

type YearMonthRouteContext = { params: Promise<{ yearMonth: string }> };

export const POST = withRoute(async (request: NextRequest, { params }: YearMonthRouteContext) => {
  assertSameOrigin(request);

  const { yearMonth } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await createEditDraftFromPublished(db, context, yearMonth));
});

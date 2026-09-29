import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { deletePublishedMonth, getPublishedMonth } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

type YearMonthRouteContext = { params: Promise<{ yearMonth: string }> };

export const GET = withRoute(async (request: NextRequest, { params }: YearMonthRouteContext) => {
  const { yearMonth } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await getPublishedMonth(db, context, yearMonth));
});

export const DELETE = withRoute(async (request: NextRequest, { params }: YearMonthRouteContext) => {
  assertSameOrigin(request);

  const { yearMonth } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await deletePublishedMonth(db, context, yearMonth));
});

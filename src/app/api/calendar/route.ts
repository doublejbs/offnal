import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { getCalendarSummary } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

export const GET = withRoute(async (request: NextRequest) => {
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return jsonResponse(await getCalendarSummary(db, context));
});

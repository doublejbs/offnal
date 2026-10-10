import { type NextRequest, NextResponse } from 'next/server';

import { runWithAnalyticsRequest } from '@/server/analytics/AnalyticsRequestScope';
import { NO_STORE } from '@/server/http/RouteHelpers';
import { recordClientEvent } from '@/server/services/ClientEventService';

export const runtime = 'nodejs';

/**
 * Client analytics beacon (Spec §26.5). Always 204 with no body — accepted, dropped or failed alike — so
 * the page never waits on or reacts to it. Refreshed Supabase cookies still go on the response.
 */
export const POST = async (request: NextRequest): Promise<Response> =>
  runWithAnalyticsRequest(request.headers, async () => {
    const supabase = await recordClientEvent(request);
    const response = new NextResponse(null, { status: 204, headers: { 'Cache-Control': NO_STORE } });

    return supabase ? supabase.applyCookies(response) : response;
  });

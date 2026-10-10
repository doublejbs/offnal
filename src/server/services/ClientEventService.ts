import 'server-only';

import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { AnalyticsSink } from '@/domain/enums/AnalyticsSink';
import { track } from '@/server/analytics/Analytics';
import { parseClientEvent } from '@/server/analytics/ClientEventSchema';
import { hashIp } from '@/server/auth/SessionService';
import { type SupabaseRouteClient } from '@/server/auth/SupabaseServerClient';
import { getAppConfig } from '@/server/config/AppConfig';
import { getDb } from '@/server/db/Database';
import { ApiError } from '@/server/errors/ApiError';
import { getClientIpFromHeaders } from '@/server/http/ClientIp';
import { readLimitedText } from '@/server/http/LimitedBody';
import { getRequestSession } from '@/server/http/RequestContext';
import { assertSameOrigin } from '@/server/http/RouteHelpers';
import { enforceClientEventLimit } from '@/server/services/RateLimitService';

/** A client event is a few dozen bytes; anything larger (in bytes) is not ours. */
const MAX_BODY_LENGTH = 1024;

/** Expected drops (another site, over the daily limit): not worth a log line. */
const QUIET_ERROR_CODES: ReadonlySet<ApiErrorCode> = new Set([
  ApiErrorCode.FORBIDDEN_ORIGIN,
  ApiErrorCode.RATE_LIMITED,
]);

const readBody = async (request: NextRequest): Promise<unknown> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);

  if (declaredLength > MAX_BODY_LENGTH) {
    return null;
  }

  // Content-Length may be absent or wrong: the limit is enforced while reading.
  const text = await readLimitedText(request.body, MAX_BODY_LENGTH);

  if (text === null) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const logFailure = (error: unknown): void => {
  if (error instanceof ApiError && QUIET_ERROR_CODES.has(error.code)) {
    return;
  }

  console.warn('[analytics] client event dropped', {
    name: error instanceof Error ? error.name : typeof error,
  });
};

/**
 * POST /api/events (Spec §26.5): any Content-Type (the beacon sends text/plain JSON), same origin, allowlisted client events with declared properties only, a
 * daily limit per IP, the actor from the session (never the body). Anything else is dropped silently:
 * this never throws, so the caller always answers 204. Returns the Supabase client whose refreshed
 * cookies belong on the response (null when the session was not resolved).
 */
export const recordClientEvent = async (request: NextRequest): Promise<SupabaseRouteClient | null> => {
  let supabase: SupabaseRouteClient | null = null;

  try {
    if (getAppConfig().analyticsSink === AnalyticsSink.OFF) {
      return null;
    }

    assertSameOrigin(request);

    const payload = parseClientEvent(await readBody(request));

    if (!payload) {
      return null;
    }

    const db = await getDb();

    await enforceClientEventLimit(db, hashIp(getClientIpFromHeaders(request.headers)));

    const session = await getRequestSession(request, db);

    supabase = session.supabase;
    track(payload.event, { actorUserId: session.context.user?.id ?? null, properties: payload.properties });
  } catch (error: unknown) {
    logFailure(error);
  }

  return supabase;
};

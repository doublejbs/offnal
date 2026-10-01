import { type NextRequest } from 'next/server';

import { type SupabaseRouteClient } from '@/server/auth/SupabaseServerClient';
import { type Db, getDb } from '@/server/db/Database';
import { getRequestSession, type RequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, toErrorResponse } from '@/server/http/RouteHelpers';

export type ParamsRouteContext<TParams> = { params: Promise<TParams> };

/** `[id]` segment params (shared by recognition and draft routes). */
export type IdParams = { id: string };

/** `[yearMonth]` segment params. */
export type YearMonthParams = { yearMonth: string };

/** `[token]` segment params (public share link). */
export type TokenParams = { token: string };

/** `/api/teams/[id]`. */
export type TeamParams = { id: string };

/** `/api/teams/[id]/rosters/[rosterId]`. */
export type TeamRosterParams = { id: string; rosterId: string };

/** `/api/teams/[id]/members/[userId]`. */
export type TeamMemberParams = { id: string; userId: string };

/** `/api/teams/[id]/invites/[inviteId]`. */
export type TeamInviteParams = { id: string; inviteId: string };

/** `/api/teams/[id]/roster/[yearMonth]`. */
export type TeamMonthParams = { id: string; yearMonth: string };

/** Routes without dynamic segments. */
export type NoParams = Record<string, never>;

export type ApiRouteArgs<TParams> = {
  request: NextRequest;
  params: TParams;
  db: Db;
  context: RequestContext;
};

export type ApiRouteOptions = {
  /** POST/PATCH/DELETE: enforce the same-origin (CSRF) check before anything else. */
  mutating: boolean;
};

/**
 * Standard JSON API route: origin check (mutating), params, DB and request context.
 * A returned Response is sent as-is; any other value becomes a no-store JSON 200. Errors map to JSON
 * errors like `withRoute`. Supabase cookies refreshed while resolving the session are applied to
 * every response, error responses included — a lost rotated refresh token would log the user out.
 */
export const apiRoute =
  <TParams>(options: ApiRouteOptions, handler: (args: ApiRouteArgs<TParams>) => Promise<unknown>) =>
  async (request: NextRequest, routeContext: ParamsRouteContext<TParams>): Promise<Response> => {
    let supabase: SupabaseRouteClient | null = null;
    let response: Response;

    try {
      if (options.mutating) {
        assertSameOrigin(request);
      }

      const params = await routeContext.params;
      const db = await getDb();
      const session = await getRequestSession(request, db);

      supabase = session.supabase;

      const result = await handler({ request, params, db, context: session.context });

      response = result instanceof Response ? result : jsonResponse(result);
    } catch (error: unknown) {
      response = toErrorResponse(request, error);
    }

    return supabase ? supabase.applyCookies(response) : response;
  };

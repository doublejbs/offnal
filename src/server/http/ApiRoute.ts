import { type NextRequest } from 'next/server';

import { type Db, getDb } from '@/server/db/Database';
import { getRequestContext, type RequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, withRoute } from '@/server/http/RouteHelpers';

export type ParamsRouteContext<TParams> = { params: Promise<TParams> };

/** `[id]` segment params (shared by recognition and draft routes). */
export type IdParams = { id: string };

/** `[yearMonth]` segment params. */
export type YearMonthParams = { yearMonth: string };

/** `[token]` segment params (public share link). */
export type TokenParams = { token: string };

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
 * A returned Response is sent as-is; any other value becomes a no-store JSON 200.
 */
export const apiRoute = <TParams>(
  options: ApiRouteOptions,
  handler: (args: ApiRouteArgs<TParams>) => Promise<unknown>,
) =>
  withRoute(async (request: NextRequest, routeContext: ParamsRouteContext<TParams>) => {
    if (options.mutating) {
      assertSameOrigin(request);
    }

    const params = await routeContext.params;
    const db = await getDb();
    const context = await getRequestContext(request, db);
    const result = await handler({ request, params, db, context });

    return result instanceof Response ? result : jsonResponse(result);
  });

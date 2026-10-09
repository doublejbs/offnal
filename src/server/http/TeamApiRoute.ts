import { type NextRequest } from 'next/server';

import {
  apiRoute,
  type ApiRouteArgs,
  type ApiRouteOptions,
  type ParamsRouteContext,
} from '@/server/http/ApiRoute';
import { toErrorResponse } from '@/server/http/RouteHelpers';
import { assertTeamsEnabled } from '@/server/services/TeamGuard';

/**
 * `apiRoute` for every team-only API (`/api/teams/**`, `/api/invites/**`). In team "준비 중" mode the route
 * answers 404 NOT_FOUND before anything else — origin check, session, DB, body (Spec §24.2).
 */
export const teamApiRoute = <TParams>(
  options: ApiRouteOptions,
  handler: (args: ApiRouteArgs<TParams>) => Promise<unknown>,
) => {
  const route = apiRoute<TParams>(options, handler);

  return async (request: NextRequest, routeContext: ParamsRouteContext<TParams>): Promise<Response> => {
    try {
      assertTeamsEnabled();
    } catch (error: unknown) {
      return toErrorResponse(request, error);
    }

    return route(request, routeContext);
  };
};

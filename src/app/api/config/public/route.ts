import { type NextRequest } from 'next/server';

import { buildPublicConfig } from '@/server/config/PublicConfig';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

export const GET = withRoute(async (_request: NextRequest) => jsonResponse(buildPublicConfig()));

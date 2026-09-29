import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { getRequestContext } from '@/server/http/RequestContext';
import { NO_STORE, withRoute } from '@/server/http/RouteHelpers';
import { readSourceImage } from '@/server/services/RecognitionService';

export const runtime = 'nodejs';

type IdRouteContext = { params: Promise<{ id: string }> };

/** Original photo for the logged-in owner only; never cached, never a public URL. */
export const GET = withRoute(async (request: NextRequest, { params }: IdRouteContext) => {
  const { id } = await params;
  const db = await getDb();
  const context = await getRequestContext(request, db);
  const source = await readSourceImage(db, context, id);

  return new Response(new Uint8Array(source.bytes), {
    status: 200,
    headers: {
      'Content-Type': source.mime,
      'Content-Length': String(source.bytes.length),
      'Cache-Control': `private, ${NO_STORE}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
});

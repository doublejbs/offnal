import { apiRoute, type TeamRosterParams } from '@/server/http/ApiRoute';
import { NO_STORE } from '@/server/http/RouteHelpers';
import { readRosterSourceImage } from '@/server/services/TeamRosterQueries';

export const runtime = 'nodejs';

/** Original roster photo for team admins only (410 once deleted/expired); never cached. */
export const GET = apiRoute<TeamRosterParams>({ mutating: false }, async ({ db, context, params }) => {
  const source = await readRosterSourceImage(db, context, params.id, params.rosterId);
  const body = new Uint8Array(
    source.bytes.buffer as ArrayBuffer,
    source.bytes.byteOffset,
    source.bytes.byteLength,
  );

  return new Response(body, {
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

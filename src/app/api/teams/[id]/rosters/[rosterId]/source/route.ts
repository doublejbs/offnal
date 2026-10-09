import { type TeamRosterParams } from '@/server/http/ApiRoute';
import { privateImageResponse } from '@/server/http/ImageResponse';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { readRosterSourceImage } from '@/server/services/TeamRosterQueries';

export const runtime = 'nodejs';

/** Original roster photo for team admins only (410 once deleted/expired); never cached. */
export const GET = teamApiRoute<TeamRosterParams>({ mutating: false }, async ({ db, context, params }) => {
  const source = await readRosterSourceImage(db, context, params.id, params.rosterId);

  return privateImageResponse(source.bytes, source.mime);
});

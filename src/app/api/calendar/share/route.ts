import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { updateShareRequestSchema } from '@/server/services/RequestSchemas';
import { disableShare, getShareSettings, updateShare } from '@/server/services/ShareService';

export const runtime = 'nodejs';

export const GET = apiRoute<NoParams>({ mutating: false }, async ({ db, context }) =>
  getShareSettings(db, context),
);

export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) =>
  updateShare(db, context, await parseJsonBody(request, updateShareRequestSchema)),
);

export const DELETE = apiRoute<NoParams>({ mutating: true }, async ({ db, context }) =>
  disableShare(db, context),
);

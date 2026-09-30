import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { rotateShare } from '@/server/services/ShareService';

export const runtime = 'nodejs';

export const POST = apiRoute<NoParams>({ mutating: true }, async ({ db, context }) =>
  rotateShare(db, context),
);

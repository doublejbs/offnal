import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { claimRecognition } from '@/server/services/RecognitionOwnership';

export const runtime = 'nodejs';

export const POST = apiRoute<IdParams>({ mutating: true }, async ({ db, context, params }) =>
  claimRecognition(db, context, params.id),
);

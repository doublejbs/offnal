import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { getRecognitionStatus } from '@/server/services/RecognitionProcessService';

export const runtime = 'nodejs';

export const GET = apiRoute<IdParams>({ mutating: false }, async ({ db, context, params }) =>
  getRecognitionStatus(db, context, params.id),
);

import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { getCandidates } from '@/server/services/RecognitionExtractService';

export const runtime = 'nodejs';

export const GET = apiRoute<IdParams>({ mutating: false }, async ({ db, context, params }) =>
  getCandidates(db, context, params.id),
);

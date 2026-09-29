import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { extractDraft } from '@/server/services/RecognitionExtractService';
import { extractRecognitionRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';
/** The second recognition pass runs synchronously. */
export const maxDuration = 300;

export const POST = apiRoute<IdParams>({ mutating: true }, async ({ request, db, context, params }) =>
  extractDraft(db, context, params.id, await parseJsonBody(request, extractRecognitionRequestSchema)),
);

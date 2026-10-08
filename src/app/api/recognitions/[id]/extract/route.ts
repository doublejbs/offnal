import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { extractDraft } from '@/server/services/RecognitionExtractService';
import { extractRecognitionRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';
/**
 * The second recognition pass runs synchronously; the shadow OCR run queued with `after()` shares this
 * budget. Must stay a literal (read statically) equal to EXTRACT_MAX_DURATION_SECONDS (unit-tested).
 */
export const maxDuration = 300;

export const POST = apiRoute<IdParams>({ mutating: true }, async ({ request, db, context, params }) => {
  // Session lookup before this point takes milliseconds; the OCR budget keeps a 10s safety margin.
  const requestStartedAt = Date.now();

  return extractDraft(
    db,
    context,
    params.id,
    await parseJsonBody(request, extractRecognitionRequestSchema),
    requestStartedAt,
  );
});

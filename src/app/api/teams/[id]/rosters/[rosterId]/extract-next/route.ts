import { type TeamRosterParams } from '@/server/http/ApiRoute';
import { parseOptionalJsonBody } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { extractNextRows } from '@/server/services/TeamRosterExtractService';
import { extractNextRequestSchema } from '@/server/services/TeamRequestSchemas';

export const runtime = 'nodejs';
/** First pass and up to 4 rows (in parallel) per call, synchronously. */
export const maxDuration = 300;

/** ExtractNextRequest (optional body) → ExtractNextResponse (ADMIN, DRAFT). */
export const POST = teamApiRoute<TeamRosterParams>(
  { mutating: true },
  async ({ request, db, context, params }) =>
    extractNextRows(
      db,
      context,
      params.id,
      params.rosterId,
      await parseOptionalJsonBody(request, extractNextRequestSchema),
    ),
);

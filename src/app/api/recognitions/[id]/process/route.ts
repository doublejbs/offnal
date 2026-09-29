import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { processRecognition } from '@/server/services/RecognitionProcessService';

export const runtime = 'nodejs';
/** Synchronous recognition (no background work after the response). */
export const maxDuration = 300;

export const POST = apiRoute<IdParams>({ mutating: true }, async ({ db, context, params }) =>
  processRecognition(db, context, params.id),
);

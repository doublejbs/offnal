import { type NextRequest } from 'next/server';

import { handleOcrShadowRequest, notFoundResponse } from '@/server/services/OcrShadowInternalService';

export const runtime = 'nodejs';
/**
 * Shadow OCR (Spec §22-11) runs in this route's own function, so an OCR crash or memory spike never
 * touches the extract function. Must stay a literal (read statically) equal to
 * OCR_SHADOW_MAX_DURATION_SECONDS (unit-tested): run timeouts are capped by what is left of it.
 */
export const maxDuration = 300;

export const POST = async (request: NextRequest): Promise<Response> => {
  const routeStartedAt = Date.now();

  return handleOcrShadowRequest(request, routeStartedAt);
};

/** Other methods would answer 405 and reveal the route: they get the same bare 404. */
export const GET = async (): Promise<Response> => notFoundResponse();

/** Internal route that runs shadow OCR in its own function (Spec §22-11). */
export const OCR_SHADOW_ROUTE_PATH = '/api/internal/ocr-shadow';

/**
 * `maxDuration` (seconds) of the internal shadow OCR route. A run's timeout is capped by what is left of
 * it (measured from the route's start). The route must export it as a literal (segment config is read
 * statically); a unit test keeps both equal.
 */
export const OCR_SHADOW_MAX_DURATION_SECONDS = 300;

/** Query parameters of the internal route. */
export const OCR_SHADOW_DRAFT_PARAM = 'draftId';
export const OCR_SHADOW_JOB_PARAM = 'jobId';
/** `probe=1`: table reading only, nothing stored, numbers only in the response. */
export const OCR_SHADOW_PROBE_PARAM = 'probe';

/** Vercel Deployment Protection bypass header (Protection Bypass for Automation). */
export const VERCEL_PROTECTION_BYPASS_HEADER = 'x-vercel-protection-bypass';

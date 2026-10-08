/**
 * `maxDuration` (seconds) of the personal extract route (`/api/recognitions/[id]/extract`). Work queued
 * with `after()` runs inside the same invocation, so the shadow OCR run shares this budget (Spec §22-9).
 * The route must export it as a literal (segment config is read statically); a unit test keeps both equal.
 */
export const EXTRACT_MAX_DURATION_SECONDS = 300;

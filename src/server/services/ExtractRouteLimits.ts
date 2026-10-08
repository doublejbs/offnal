/**
 * `maxDuration` (seconds) of the personal extract route (`/api/recognitions/[id]/extract`). Work queued
 * with `after()` runs inside the same invocation, so the call to the internal shadow OCR route (Spec
 * §22-11) waits at most for what is left of it. The route must export it as a literal (segment config is
 * read statically); a unit test keeps both equal.
 */
export const EXTRACT_MAX_DURATION_SECONDS = 300;

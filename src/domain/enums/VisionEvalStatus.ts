/** Outcome of one model × sample × repeat run in the vision model comparison eval. */
export enum VisionEvalStatus {
  OK = 'ok',
  /** A provider call failed (after rate-limit retries) or pass 1 returned a failure outcome. */
  FAILED = 'failed',
}

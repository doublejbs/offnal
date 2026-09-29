/** How one truth person of one eval run counts toward accuracy. */
export enum VisionEvalPersonOutcome {
  /** Pass 2 returned a schedule, or the model missed the name (scored, all days wrong). */
  SCORED = 'scored',
  /** A model-attributable failure: every day of this person scores 0. */
  MODEL_FAILURE = 'model_failure',
  /** An infrastructure failure: excluded from both accuracies. */
  INFRA_FAILURE = 'infra_failure',
}

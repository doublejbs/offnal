/** Who a failed eval call is attributed to. */
export enum VisionEvalFailureKind {
  /** The model's own output: pass-1 no_table/unreadable/no_names, MAX_TOKENS, blocked, invalid JSON/schema. Scores 0. */
  MODEL = 'model',
  /** Service/quota/network: 429 after retries, 5xx, timeouts, other HTTP errors. Excluded from accuracy. */
  INFRA = 'infra',
}

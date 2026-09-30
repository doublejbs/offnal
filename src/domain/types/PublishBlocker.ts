import { type PublishBlockReason } from '@/domain/enums/PublishBlockReason';

export type PublishBlocker =
  | { reason: PublishBlockReason.UNCONFIRMED_DATES; dates: string[] }
  | { reason: PublishBlockReason.MISSING_TIMES | PublishBlockReason.UNDEFINED_CODES; codes: string[] };

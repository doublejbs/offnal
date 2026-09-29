import { type ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';

export type ShiftEntry = {
  /** YYYY-MM-DD */
  date: string;
  code: string | null;
  reviewReasons: ShiftReviewReason[];
  confirmed: boolean;
};

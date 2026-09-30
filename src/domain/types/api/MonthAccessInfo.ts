import { type MonthAccess } from '@/domain/enums/MonthAccess';

export type MonthAccessInfo = {
  monthAccess: MonthAccess;
  freeRemaining: number;
  priceKrw: number;
};

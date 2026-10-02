import { describe, expect, it } from 'vitest';

import {
  describeBlocker,
  describeMonthAccess,
  formatDateTime,
  formatDefinitionSummary,
  formatLegendText,
  formatMonthCount,
  formatOrdinal,
  formatPrice,
  formatRawText,
  formatReviewWarning,
  formatShiftTime,
  formatUndefinedCodesWarning,
  recognitionErrorMessage,
} from '@/client/DisplayText';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

const NIGHT: ShiftDefinition = {
  code: 'N',
  label: '나이트',
  startTime: '22:30',
  endTime: '07:30',
  endsNextDay: true,
  isOff: false,
};

describe('DisplayText', () => {
  it('formats prices with the Korean locale and never assumes a fixed price', () => {
    expect(formatPrice(1900)).toBe('1,900원');
    expect(formatPrice(990)).toBe('990원');
    expect(formatPrice(12000)).toBe('12,000원');
    expect(formatPrice(0)).toBe('0원');
  });

  it('formats month counts and ordinals in native Korean where natural', () => {
    expect(formatMonthCount(1)).toBe('한 달');
    expect(formatMonthCount(2)).toBe('두 달');
    expect(formatMonthCount(3)).toBe('세 달');
    expect(formatMonthCount(12)).toBe('12달');
    expect(formatOrdinal(1)).toBe('첫 번째');
    expect(formatOrdinal(2)).toBe('두 번째');
    expect(formatOrdinal(11)).toBe('11번째');
  });

  it('describes month access from the server decision', () => {
    expect(
      describeMonthAccess({ monthAccess: MonthAccess.TRIAL_AVAILABLE, freeRemaining: 2, priceKrw: 1900 }, 2),
    ).toEqual({ text: '첫 번째 무료 월로 저장돼요', requiresPayment: false });
    expect(
      describeMonthAccess({ monthAccess: MonthAccess.TRIAL_AVAILABLE, freeRemaining: 1, priceKrw: 1900 }, 2),
    ).toEqual({ text: '두 번째 무료 월로 저장돼요', requiresPayment: false });
    expect(
      describeMonthAccess({ monthAccess: MonthAccess.EXISTING, freeRemaining: 0, priceKrw: 1900 }, 2),
    ).toEqual({ text: '이미 등록한 달이라 추가 비용 없이 저장돼요', requiresPayment: false });
    expect(
      describeMonthAccess({ monthAccess: MonthAccess.PAYMENT_REQUIRED, freeRemaining: 0, priceKrw: 2500 }, 3),
    ).toEqual({ text: '2,500원 구매 후 저장', requiresPayment: true });
  });

  it('lists the dates that need review', () => {
    expect(formatReviewWarning({ count: 2, dates: ['2026-10-14', '2026-10-20'] })).toBe(
      '확인 필요한 날짜가 2일 있어요: 14일, 20일',
    );
    expect(formatReviewWarning({ count: 0, dates: [] })).toBeNull();
  });

  it('formats the warning for codes outside the legend', () => {
    expect(formatUndefinedCodesWarning(['W', '연차'])).toBe(
      '처음 보는 코드 2개: W, 연차 — 근무 시간 또는 휴무를 정해 주세요',
    );
    expect(formatUndefinedCodesWarning([])).toBeNull();
  });

  it('describes publish blockers', () => {
    expect(describeBlocker({ reason: PublishBlockReason.UNCONFIRMED_DATES, dates: ['2026-10-14'] })).toBe(
      '근무를 확인하지 않은 날짜 1일: 14일',
    );
    expect(describeBlocker({ reason: PublishBlockReason.MISSING_TIMES, codes: ['E', 'X'] })).toBe(
      '근무 시간을 입력하지 않은 코드: E, X',
    );
    expect(describeBlocker({ reason: PublishBlockReason.UNDEFINED_CODES, codes: ['Z'] })).toBe(
      '등록되지 않은 코드: Z',
    );
  });

  it('formats shift time ranges including overnight, off and missing times', () => {
    expect(formatShiftTime(NIGHT)).toBe('22:30–다음 날 07:30');
    expect(
      formatShiftTime({ ...NIGHT, code: 'D', startTime: '07:00', endTime: '16:00', endsNextDay: false }),
    ).toBe('07:00–16:00');
    expect(formatShiftTime({ ...NIGHT, isOff: true })).toBe('휴무');
    expect(formatShiftTime({ ...NIGHT, startTime: null })).toBe('시간을 입력해 주세요');
    expect(formatShiftTime(undefined)).toBe('등록되지 않은 코드예요');
  });

  it('distinguishes missing source cells, unreadable cells, and blank cells', () => {
    expect(formatRawText(undefined)).toBe('원본에서 찾지 못함');
    expect(formatRawText(null)).toBe('읽지 못함');
    expect(formatRawText('')).toBe('빈칸');
    expect(formatRawText('  ')).toBe('빈칸');
    expect(formatRawText('E?')).toBe('E?');
  });

  it('never repeats the off label in legends', () => {
    const off: ShiftDefinition = { ...NIGHT, code: 'OFF', label: '휴무', isOff: true };

    expect(formatLegendText(off)).toBe('휴무');
    expect(formatDefinitionSummary(off)).toBe('OFF · 휴무');
    expect(formatDefinitionSummary(NIGHT)).toBe('N · 나이트 · 22:30–다음 날 07:30');
    expect(formatLegendText({ ...NIGHT, code: 'X', label: 'X' })).toBe('22:30–다음 날 07:30');
  });

  it('formats timestamps in Asia/Seoul', () => {
    expect(formatDateTime('2026-09-29T09:30:00.000Z')).toBe('2026.09.29 18:30');
    expect(formatDateTime('2026-12-31T15:05:00.000Z')).toBe('2027.01.01 00:05');
  });

  it('has a Korean message for every recognition error code', () => {
    for (const code of Object.values(RecognitionErrorCode)) {
      expect(recognitionErrorMessage(code).length).toBeGreaterThan(5);
    }
  });
});

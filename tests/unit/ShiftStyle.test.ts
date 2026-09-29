import { describe, expect, it } from 'vitest';

import { describeEntryStatus, getBadgeText, getShiftTone } from '@/client/ShiftStyle';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { ShiftTone } from '@/domain/enums/ShiftTone';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

const definitions: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
  { code: 'OFF', label: '휴무', startTime: null, endTime: null, endsNextDay: null, isOff: true },
  { code: '연차', label: '연차', startTime: null, endTime: null, endsNextDay: null, isOff: true },
  { code: 'X', label: '교육', startTime: null, endTime: null, endsNextDay: null, isOff: false },
];

describe('ShiftStyle', () => {
  it('maps the standard codes to their tones', () => {
    expect(getShiftTone('D', definitions)).toBe(ShiftTone.DAY);
    expect(getShiftTone('E', definitions)).toBe(ShiftTone.EVENING);
    expect(getShiftTone('N', definitions)).toBe(ShiftTone.NIGHT);
    expect(getShiftTone('S', definitions)).toBe(ShiftTone.MIDDLE);
    expect(getShiftTone('OFF', definitions)).toBe(ShiftTone.OFF);
  });

  it('uses the off tone for custom off codes and a neutral tone for other custom codes', () => {
    expect(getShiftTone('연차', definitions)).toBe(ShiftTone.OFF);
    expect(getShiftTone('X', definitions)).toBe(ShiftTone.CUSTOM);
    expect(getShiftTone(null, definitions)).toBe(ShiftTone.UNKNOWN);
  });

  it('shows text for unconfirmed entries, not only color', () => {
    expect(getBadgeText({ date: '2026-10-20', code: null, reviewReasons: [], confirmed: false })).toBe(
      '확인',
    );
    expect(
      getBadgeText({
        date: '2026-10-14',
        code: 'E',
        reviewReasons: [ShiftReviewReason.AMBIGUOUS],
        confirmed: false,
      }),
    ).toBe('E?');
    expect(getBadgeText({ date: '2026-10-01', code: 'D', reviewReasons: [], confirmed: true })).toBe('D');
  });

  it('describes entry status for screen readers', () => {
    expect(describeEntryStatus({ date: '2026-10-14', code: 'E', reviewReasons: [], confirmed: false })).toBe(
      'E 확인 필요',
    );
    expect(describeEntryStatus({ date: '2026-10-20', code: null, reviewReasons: [], confirmed: false })).toBe(
      '근무 미확인 확인 필요',
    );
    expect(describeEntryStatus({ date: '2026-10-01', code: 'D', reviewReasons: [], confirmed: true })).toBe(
      'D',
    );
  });
});

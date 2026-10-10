import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { listDates } from '@/domain/YearMonth';

/**
 * Fictional sample month for the entry-screen preview (Spec §26.2), reusable by the sample trial (§26.3).
 * Not a real person's schedule. November 2026 starts on a Sunday, so the first visible rows are full weeks.
 */
export const SAMPLE_YEAR_MONTH = '2026-11';

export const SAMPLE_PREVIEW_LABEL =
  '예시 근무 달력: D 데이·E 이브닝·N 나이트·OFF 휴무가 날짜마다 표시된 달력';

export const SAMPLE_PREVIEW_CAPTION = '이런 달력이 만들어져요 · 예시';

export const REGULAR_CODE = '상근';

export const SAMPLE_DEFINITIONS: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: '07:00', endTime: '15:00', endsNextDay: false, isOff: false },
  { code: 'E', label: '이브닝', startTime: '15:00', endTime: '23:00', endsNextDay: false, isOff: false },
  { code: 'N', label: '나이트', startTime: '23:00', endTime: '07:00', endsNextDay: true, isOff: false },
  { code: 'OFF', label: '휴무', startTime: null, endTime: null, endsNextDay: null, isOff: true },
  {
    code: REGULAR_CODE,
    label: '상근',
    startTime: '09:00',
    endTime: '18:00',
    endsNextDay: false,
    isOff: false,
  },
];

/** One code per day of the month, Sunday-first weeks: every code already appears in the first two weeks. */
export const SAMPLE_PREVIEW_CODES: string[] = [
  ...['D', 'D', 'E', 'E', 'N', 'N', 'OFF'],
  ...['OFF', REGULAR_CODE, 'D', 'E', 'N', 'OFF', 'OFF'],
  ...['E', 'E', 'N', 'N', 'OFF', 'D', 'D'],
  ...['OFF', 'E', 'E', 'N', 'N', 'OFF', REGULAR_CODE],
  ...['D', 'D'],
];

export const SAMPLE_ENTRIES: ShiftEntry[] = listDates(SAMPLE_YEAR_MONTH).map((date, index) => ({
  date,
  code: SAMPLE_PREVIEW_CODES[index] ?? 'OFF',
  reviewReasons: [],
  confirmed: true,
}));

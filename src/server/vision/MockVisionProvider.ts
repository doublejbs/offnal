import { setTimeout as sleep } from 'node:timers/promises';

import sharp from 'sharp';

import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type DayHeader } from '@/domain/types/DayHeader';
import { type ExtractedCell } from '@/domain/types/ExtractedCell';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type TableRecognitionResult } from '@/domain/types/TableRecognitionResult';
import {
  currentYearMonthInSeoul,
  daysInMonth,
  listDates,
  nextYearMonth,
  weekdayOf,
} from '@/domain/YearMonth';
import { type VisionImage, type VisionProvider } from '@/server/vision/VisionProvider';

/** Virtual people only (demo/test fixture). The last one exercises long-name wrapping. */
export const MOCK_CANDIDATE_NAMES = ['김하루', '이여름', '박지우', '남궁하늘빛나래'];

/** Virtual times — not a real hospital's schedule. */
export const MOCK_DEFINITIONS: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
  { code: 'E', label: '이브닝', startTime: '15:00', endTime: '23:00', endsNextDay: false, isOff: false },
  { code: 'N', label: '나이트', startTime: '22:30', endTime: '07:30', endsNextDay: true, isOff: false },
  { code: 'S', label: '상근', startTime: '09:00', endTime: '18:00', endsNextDay: false, isOff: false },
  { code: 'OFF', label: '휴무', startTime: null, endTime: null, endsNextDay: null, isOff: true },
];

const MIN_TABLE_WIDTH = 300;
const AMBIGUOUS_DAY = 14;
const UNREADABLE_DAY = 20;
const SHIFT_PATTERN = ['D', 'D', 'E', 'E', 'N', 'N', 'OFF', 'OFF', 'S', 'OFF'];
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export type MockVisionOptions = {
  delayMs: number;
  now?: () => Date;
};

const waitFor = async (delayMs: number, signal: AbortSignal): Promise<void> => {
  if (delayMs > 0) {
    await sleep(delayMs, undefined, { signal });
  }

  signal.throwIfAborted();
};

const buildRowId = (index: number): string => `r${index + 1}`;

const buildDayHeaders = (yearMonth: string): DayHeader[] =>
  listDates(yearMonth).map((date, index) => ({
    day: index + 1,
    weekday: WEEKDAY_NAMES[weekdayOf(date)] ?? null,
  }));

const buildCell = (day: number, rowIndex: number): ExtractedCell => {
  if (day === AMBIGUOUS_DAY) {
    return { day, rawText: 'E?', code: 'E', ambiguous: true };
  }

  if (day === UNREADABLE_DAY) {
    return { day, rawText: null, code: null, ambiguous: false };
  }

  const code = SHIFT_PATTERN[(day - 1 + rowIndex * 3) % SHIFT_PATTERN.length] ?? 'OFF';

  return { day, rawText: code, code, ambiguous: false };
};

/** Deterministic fixture provider (Spec §8). Only constructed outside production. */
export const createMockVisionProvider = (options: MockVisionOptions): VisionProvider => {
  const now = options.now ?? (() => new Date());

  return {
    kind: VisionProviderType.MOCK,
    recognizeTable: async (image: VisionImage, signal: AbortSignal): Promise<TableRecognitionResult> => {
      await waitFor(options.delayMs, signal);

      const { width } = await sharp(image.bytes).metadata();

      if (!width || width < MIN_TABLE_WIDTH) {
        return { ok: false, errorCode: RecognitionErrorCode.NO_TABLE };
      }

      const yearMonth = nextYearMonth(currentYearMonthInSeoul(now()));

      return {
        ok: true,
        value: {
          yearMonth,
          candidates: MOCK_CANDIDATE_NAMES.map((name, index) => ({ rowId: buildRowId(index), name })),
          definitions: MOCK_DEFINITIONS.map((definition) => ({ ...definition })),
          dayHeaders: buildDayHeaders(yearMonth),
        },
      };
    },
    extractPerson: async (_image, input, signal): Promise<PersonExtraction> => {
      await waitFor(options.delayMs, signal);

      const rowIndex = Math.max(
        0,
        MOCK_CANDIDATE_NAMES.findIndex((_, index) => buildRowId(index) === input.rowId),
      );
      const dayCount = daysInMonth(input.yearMonth);

      return {
        yearMonth: input.yearMonth,
        rowId: input.rowId,
        displayName: input.name,
        definitions: MOCK_DEFINITIONS.map((definition) => ({ ...definition })),
        cells: Array.from({ length: dayCount }, (_, index) => buildCell(index + 1, rowIndex)),
      };
    },
  };
};

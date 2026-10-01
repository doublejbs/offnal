import { setTimeout as sleep } from 'node:timers/promises';

import sharp from 'sharp';

import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { MOCK_UNDEFINED_CODE_DAYS } from '@/domain/MockFixtureDays';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type DayHeader } from '@/domain/types/DayHeader';
import { type ExtractedCell } from '@/domain/types/ExtractedCell';
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

/**
 * Whole-team fixture (team roster uploads, Team spec §6): returned for images at least
 * MOCK_TEAM_TABLE_MIN_WIDTH wide. Virtual people; 김하루 appears twice (same-name rows r1 and r4).
 */
export const MOCK_TEAM_CANDIDATE_NAMES = [
  '김하루',
  '이여름',
  '박지우',
  '김하루',
  '최가을',
  '정겨울',
  '한바다',
  '오하늘',
  '윤소리',
  '남궁하늘빛나래',
];

export const MOCK_TEAM_TABLE_MIN_WIDTH = 1600;

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

const ROW_ID_PATTERN = /^r(\d+)$/u;

const buildRowId = (index: number): string => `r${index + 1}`;

/** `r{n}` → n - 1 (deterministic pattern per row for any number of rows); unknown ids use row 0. */
const parseRowIndex = (rowId: string): number => {
  const match = ROW_ID_PATTERN.exec(rowId);

  return match ? Math.max(0, Number(match[1]) - 1) : 0;
};

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

  const undefinedCode = MOCK_UNDEFINED_CODE_DAYS[day];

  if (undefinedCode) {
    return { day, rawText: undefinedCode, code: undefinedCode, ambiguous: false };
  }

  const code = SHIFT_PATTERN[(day - 1 + rowIndex * 3) % SHIFT_PATTERN.length] ?? 'OFF';

  return { day, rawText: code, code, ambiguous: false };
};

/** Deterministic fixture provider (Spec §8). Only constructed outside production. */
export const createMockVisionProvider = (options: MockVisionOptions): VisionProvider => {
  const now = options.now ?? (() => new Date());

  const extractPerson: VisionProvider['extractPerson'] = async (_image, input, signal) => {
    await waitFor(options.delayMs, signal);

    const rowIndex = parseRowIndex(input.rowId);
    const dayCount = daysInMonth(input.yearMonth);

    return {
      yearMonth: input.yearMonth,
      rowId: input.rowId,
      displayName: input.name,
      definitions: MOCK_DEFINITIONS.map((definition) => ({ ...definition })),
      cells: Array.from({ length: dayCount }, (_, index) => buildCell(index + 1, rowIndex)),
      reading: {
        rowName: input.name,
        targetInStrip: true,
        sameNameOrdinal: input.rowContext?.sameNameOrdinal ?? null,
      },
    };
  };

  return {
    kind: VisionProviderType.MOCK,
    recognizeTable: async (image: VisionImage, signal: AbortSignal): Promise<TableRecognitionResult> => {
      await waitFor(options.delayMs, signal);

      const { width } = await sharp(image.bytes).metadata();

      if (!width || width < MIN_TABLE_WIDTH) {
        return { ok: false, errorCode: RecognitionErrorCode.NO_TABLE };
      }

      const yearMonth = nextYearMonth(currentYearMonthInSeoul(now()));
      const names = width >= MOCK_TEAM_TABLE_MIN_WIDTH ? MOCK_TEAM_CANDIDATE_NAMES : MOCK_CANDIDATE_NAMES;

      return {
        ok: true,
        value: {
          yearMonth,
          candidates: names.map((name, index) => ({ rowId: buildRowId(index), name })),
          definitions: MOCK_DEFINITIONS.map((definition) => ({ ...definition })),
          dayHeaders: buildDayHeaders(yearMonth),
          // No corners: the pipeline keeps using the original image (Spec §15 fallback).
          grid: null,
        },
      };
    },
    extractPerson,
    locateRow: async (_image, _input, signal) => {
      await waitFor(options.delayMs, signal);

      return { band: null, rowName: null };
    },
    extractPersonFromStrip: async (strip, _reference, input, signal) => extractPerson(strip, input, signal),
  };
};

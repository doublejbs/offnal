import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { OcrCodeSource } from '@/domain/enums/OcrCodeSource';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type OcrCell, type OcrRow, type OcrTable } from '@/server/vision/ocr/OcrTableTypes';

/** February 2026: 28 days keeps the fixtures short. */
export const SHADOW_MONTH = '2026-02';
export const SHADOW_NAME = '김하루';
export const OTHER_NAME = '이바다';

const RECT = { left: 0, top: 0, right: 10, bottom: 10 };

const buildDefinition = (code: string): ShiftDefinition => ({
  code,
  label: code,
  startTime: '07:00',
  endTime: '15:00',
  endsNextDay: false,
  isOff: false,
});

export const SHADOW_DEFINITIONS = ['D', 'E', 'N'].map(buildDefinition);

/** A decided code (`code`), unresolved text (`?`), a blank (`null`) or faint ink (`~`). */
export type CellSpec = string | null;

const buildCell = (day: number, spec: CellSpec): OcrCell => {
  const base = { day, rect: RECT, confidence: 90, glyphPng: null };

  if (spec === null) {
    return { ...base, ink: OcrCellInk.BLANK, token: null, code: null, source: OcrCodeSource.NONE };
  }

  if (spec === '~') {
    return { ...base, ink: OcrCellInk.AMBIGUOUS, token: null, code: null, source: OcrCodeSource.NONE };
  }

  if (spec === '?') {
    return { ...base, ink: OcrCellInk.TEXT, token: 'Q', code: null, source: OcrCodeSource.NONE };
  }

  return { ...base, ink: OcrCellInk.TEXT, token: spec, code: spec, source: OcrCodeSource.OCR };
};

export const buildOcrRow = (index: number, name: string | null, specs: CellSpec[]): OcrRow => ({
  index,
  rect: RECT,
  name,
  nameConfidence: 90,
  cells: specs.map((spec, day) => buildCell(day + 1, spec)),
});

export const buildOcrTable = (rows: OcrRow[]): OcrTable => ({
  yearMonth: SHADOW_MONTH,
  dayCount: 28,
  rows,
  definitions: SHADOW_DEFINITIONS,
  dictionary: SHADOW_DEFINITIONS.map((definition) => definition.code),
});

/** The AI result as the extract route stores it (`normalizeExtraction` of the second pass). */
export const buildAiSchedule = (codes: (string | null)[]): NormalizedSchedule =>
  normalizeExtraction(
    {
      yearMonth: SHADOW_MONTH,
      rowId: 'r1',
      displayName: SHADOW_NAME,
      definitions: SHADOW_DEFINITIONS,
      cells: codes.map((code, day) => ({ day: day + 1, rawText: code, code, ambiguous: false })),
    },
    SHADOW_MONTH,
  );

export const repeatCode = (code: string, count: number): string[] =>
  Array.from({ length: count }, () => code);

/**
 * AI: D except E on day 2, N on day 3, blank on day 4. OCR: day 2 read N (disagree), day 3 unresolved,
 * day 4 read D (AI null), the grid stops after day 26 (days 27–28 missing).
 */
export const MIXED_AI_CODES: (string | null)[] = ['D', 'E', 'N', null, ...repeatCode('D', 24)];
export const MIXED_OCR_SPECS: CellSpec[] = ['D', 'N', '?', 'D', ...repeatCode('D', 22)];

import { type OcrCellInk } from '@/domain/enums/OcrCellInk';
import { type OcrCodeSource } from '@/domain/enums/OcrCodeSource';
import { type OcrTableFailure } from '@/domain/enums/OcrTableFailure';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type TableGrid } from '@/server/vision/ocr/GridDetector';
import { type WarpedTable } from '@/server/vision/ocr/TableWarp';
import { type PixelRect, type Quad } from '@/server/vision/VisionGeometry';

/** One day cell of a person row after OCR and dictionary matching. */
export type OcrCell = {
  day: number;
  ink: OcrCellInk;
  rect: PixelRect;
  /** Normalized OCR token (text cells only). */
  token: string | null;
  confidence: number | null;
  /** Dictionary code; null for blank/dash cells and for unresolved text cells. */
  code: string | null;
  /** Cleaned glyph PNG sent to OCR (text cells only; memory only, the eval saves it as a debug image). */
  glyphPng: Buffer | null;
  source: OcrCodeSource;
};

export type OcrRow = {
  /** 0-based position among the person rows, top to bottom ("tap my row" index). */
  index: number;
  rect: PixelRect;
  /** Hangul read from the name cell (spaces removed), null when unreadable. */
  name: string | null;
  nameConfidence: number | null;
  cells: OcrCell[];
};

export type OcrTable = {
  /** From the title ("YYYY 년 M 월"), null when not found. */
  yearMonth: string | null;
  dayCount: number;
  rows: OcrRow[];
  /** Legend definitions (times) plus OFF as off when it occurs. */
  definitions: ShiftDefinition[];
  /** Every code accepted for cells (legend + OFF + frequent tokens). */
  dictionary: string[];
};

/** Intermediate geometry kept for debug images. */
export type OcrGeometry = {
  quad: Quad | null;
  warped: WarpedTable | null;
  grid: TableGrid | null;
  /** Row index (into grid rows) of the day-number header, null when not found. */
  headerRow: number | null;
};

export type OcrTableResult =
  | { ok: true; table: OcrTable; geometry: OcrGeometry; latencyMs: number }
  | { ok: false; failure: OcrTableFailure; geometry: OcrGeometry; latencyMs: number };

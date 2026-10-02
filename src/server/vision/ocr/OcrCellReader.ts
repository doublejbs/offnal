import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { OcrCodeSource } from '@/domain/enums/OcrCodeSource';
import { OcrLanguage } from '@/domain/enums/OcrLanguage';
import { OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';
import {
  buildCodeWhitelist,
  isHangulToken,
  isLatinToken,
  matchCode,
  normalizeToken,
  selectFrequentTokens,
  type TokenReading,
} from '@/server/vision/ocr/CodeDictionary';
import { resolveByConsensus } from '@/server/vision/ocr/GlyphConsensus';
import { describeGlyphs } from '@/server/vision/ocr/GlyphDescriptor';
import { type TableGrid } from '@/server/vision/ocr/GridDetector';
import { type GrayImage } from '@/server/vision/ocr/GrayRaster';
import { type HeaderLayout } from '@/server/vision/ocr/OcrHeaderReader';
import {
  getCellRect,
  prepareCell,
  type PreparedCell,
  readPreparedCell,
} from '@/server/vision/ocr/OcrCellText';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { type OcrCell } from '@/server/vision/ocr/OcrTableTypes';
import { type PixelRect } from '@/server/vision/VisionGeometry';

/** Every upper-case Latin letter: the discovery pass must also see codes outside the legend (W, M). */
const LATIN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CELL_INSET = 0.08;

/** A token must be read at least this often (confidently) to join the dictionary. */
export const FREQUENT_TOKEN_MIN_COUNT = 2;
export const FREQUENT_TOKEN_MIN_CONFIDENCE = 80;
/** Minimum OCR confidence to accept a dictionary code for a cell. */
export const CELL_MIN_CONFIDENCE = 60;

/** The center-focus retry must shrink the glyph box to at most this share of its height. */
const FOCUS_MAX_HEIGHT_SHARE = 0.85;

type WorkCell = {
  row: number;
  day: number;
  rect: PixelRect;
  prepared: PreparedCell;
  latin: TokenReading | null;
  hangul: TokenReading | null;
};

export type CellReadResult = {
  /** Cells per person row (same order as `rows`), days 1…dayCount. */
  cells: OcrCell[][];
  dictionary: string[];
};

const toReading = (text: { text: string; confidence: number } | null): TokenReading | null =>
  text ? { token: normalizeToken(text.text), confidence: text.confidence } : null;

const resolveCode = (
  cell: WorkCell,
  dictionary: ReadonlySet<string>,
): { code: string | null; reading: TokenReading | null } => {
  for (const reading of [cell.latin, cell.hangul]) {
    if (reading) {
      const match = matchCode(reading, dictionary, CELL_MIN_CONFIDENCE);

      if (match.code) {
        return { code: match.code, reading };
      }
    }
  }

  return { code: null, reading: cell.latin ?? cell.hangul };
};

/**
 * Reads every day cell of the person rows (Spec §20): (1) Latin discovery pass (A–Z whitelist) on every
 * text cell; (2) dictionary = legend codes + tokens read confidently ≥ 2 times; (3) cells still unresolved
 * get a Korean pass, frequent Hangul tokens (연차) join the dictionary; (4) a last Latin pass restricted to
 * the dictionary's letters. A cell keeps a code only for an exact, confident dictionary match.
 */
export const readPersonCells = async (
  ocr: OcrProvider,
  gray: GrayImage,
  grid: TableGrid,
  layout: HeaderLayout,
  personRows: number[],
  dayCount: number,
  legendCodes: string[],
): Promise<CellReadResult> => {
  const work: WorkCell[] = await Promise.all(
    personRows.flatMap((row) =>
      Array.from({ length: dayCount }, async (_value, index) => {
        const rect = getCellRect(grid.rowLines, grid.columnLines, row, layout.dayOneColumn + index);
        const prepared = await prepareCell(gray, rect, { inset: CELL_INSET, dropEnclosing: true });

        return { row, day: index + 1, rect, prepared, latin: null, hangul: null };
      }),
    ),
  );
  const textCells = work.filter((cell) => cell.prepared.png !== null);

  await Promise.all(
    textCells.map(async (cell) => {
      cell.latin = toReading(
        await readPreparedCell(ocr, cell.prepared, {
          languages: [OcrLanguage.ENGLISH],
          whitelist: LATIN_LETTERS,
          pageSegMode: OcrPageSegMode.SINGLE_LINE,
        }),
      );
    }),
  );

  const latinTokens = textCells.flatMap((cell) =>
    cell.latin && isLatinToken(cell.latin.token) ? [cell.latin] : [],
  );
  const dictionary = new Set([
    ...legendCodes,
    ...selectFrequentTokens(latinTokens, FREQUENT_TOKEN_MIN_COUNT, FREQUENT_TOKEN_MIN_CONFIDENCE),
  ]);
  const unresolved = () => textCells.filter((cell) => resolveCode(cell, dictionary).code === null);

  await Promise.all(
    unresolved().map(async (cell) => {
      cell.hangul = toReading(
        await readPreparedCell(ocr, cell.prepared, {
          languages: [OcrLanguage.KOREAN],
          whitelist: null,
          pageSegMode: OcrPageSegMode.SINGLE_LINE,
        }),
      );
    }),
  );

  const hangulTokens = textCells.flatMap((cell) =>
    cell.hangul && isHangulToken(cell.hangul.token) ? [cell.hangul] : [],
  );

  for (const token of selectFrequentTokens(
    hangulTokens,
    FREQUENT_TOKEN_MIN_COUNT,
    FREQUENT_TOKEN_MIN_CONFIDENCE,
  )) {
    dictionary.add(token);
  }

  const whitelist = buildCodeWhitelist(dictionary);

  if (whitelist.latin.length > 0) {
    await Promise.all(
      unresolved().map(async (cell) => {
        const restricted = toReading(
          await readPreparedCell(ocr, cell.prepared, {
            languages: [OcrLanguage.ENGLISH],
            whitelist: whitelist.latin,
            pageSegMode: OcrPageSegMode.SINGLE_LINE,
          }),
        );

        if (restricted && matchCode(restricted, dictionary, CELL_MIN_CONFIDENCE).code) {
          cell.latin = restricted;
        }
      }),
    );
  }

  // Retry: unresolved cells cleaned down to their center glyph cluster (circles, highlighter edges).
  await Promise.all(
    unresolved().map(async (cell) => {
      const focused = await prepareCell(gray, cell.rect, {
        inset: CELL_INSET,
        dropEnclosing: true,
        focusCenter: true,
      });
      const originalHeight = cell.prepared.clean.glyphs?.height ?? 0;
      const focusedHeight = focused.clean.glyphs?.height ?? 0;

      // Only a retry that removed something taller than the glyphs (circle arc, highlighter edge) counts:
      // dropping same-height letters would turn OFF into O.
      if (!focused.png || focusedHeight > originalHeight * FOCUS_MAX_HEIGHT_SHARE) {
        return;
      }

      const reading = toReading(
        await readPreparedCell(ocr, focused, {
          languages: [OcrLanguage.ENGLISH],
          whitelist: whitelist.latin.length > 0 ? whitelist.latin : LATIN_LETTERS,
          pageSegMode: OcrPageSegMode.SINGLE_LINE,
        }),
      );

      if (reading && matchCode(reading, dictionary, CELL_MIN_CONFIDENCE).code) {
        cell.prepared = focused;
        cell.latin = reading;
      }
    }),
  );

  const resolved = work.map((cell) => resolveCode(cell, dictionary));
  const consensus = resolveByConsensus(
    work.map((cell, index) => ({
      descriptor: cell.prepared.clean.shades ? describeGlyphs(cell.prepared.clean.shades) : null,
      code: resolved[index]!.code,
      token: resolved[index]!.reading?.token ?? '',
    })),
    [...dictionary],
  );
  const cells = personRows.map((row) =>
    work.flatMap((cell, index): OcrCell[] => {
      if (cell.row !== row) {
        return [];
      }

      const isText = cell.prepared.clean.ink === OcrCellInk.TEXT;
      const decision = consensus.decisions[index]!;
      const reading = resolved[index]!.reading;

      return [
        {
          day: cell.day,
          ink: cell.prepared.clean.ink,
          rect: cell.rect,
          token: isText ? (reading?.token ?? '') : null,
          confidence: reading?.confidence ?? null,
          code: isText ? decision.code : null,
          source: isText ? decision.source : OcrCodeSource.NONE,
          glyphPng: cell.prepared.png,
        },
      ];
    }),
  );

  return { cells, dictionary: consensus.dictionary };
};

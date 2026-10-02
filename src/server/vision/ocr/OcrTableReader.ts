import { OcrLanguage } from '@/domain/enums/OcrLanguage';
import { OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';
import { OcrTableFailure } from '@/domain/enums/OcrTableFailure';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { daysInMonth } from '@/domain/YearMonth';
import { OFF_CODE } from '@/server/vision/ocr/CodeDictionary';
import { renderGrayPng } from '@/server/vision/ocr/GlyphImage';
import { cropGray, type GrayImage } from '@/server/vision/ocr/GrayRaster';
import { detectGrid, type TableGrid } from '@/server/vision/ocr/GridDetector';
import { eraseGridLines } from '@/server/vision/ocr/LineEraser';
import { extendDayCount } from '@/server/vision/ocr/HeaderValidator';
import { median } from '@/server/vision/ocr/LineProfile';
import { readPersonCells } from '@/server/vision/ocr/OcrCellReader';
import { getCellRect, prepareCell, readPreparedCell } from '@/server/vision/ocr/OcrCellText';
import { type HeaderLayout, readHeaderLayout } from '@/server/vision/ocr/OcrHeaderReader';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { type OcrGeometry, type OcrRow, type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';
import { detectTableQuad } from '@/server/vision/ocr/TableQuadDetector';
import { warpTable } from '@/server/vision/ocr/TableWarp';
import {
  buildOffDefinition,
  parseLegendDefinitions,
  parseTitleYearMonth,
} from '@/server/vision/ocr/TextPatterns';
import { type PixelRect, type RawImage } from '@/server/vision/VisionGeometry';

/** Share of the table width searched for the title (it sits above the left half). */
const TITLE_WIDTH_SHARE = 0.6;
/** Title band above the table and the legend's first line below it, as shares of the table height. */
const TITLE_HEIGHT_SHARE = 0.2;
const LEGEND_HEIGHT_SHARE = 0.12;
/** Text blocks are upscaled so a person row would be at least this tall (small photos). */
const TEXT_ROW_TARGET_PX = 80;
const NAME_INSET = 0.06;
/** Runs this share of a day column / person row long are grid lines (glyph strokes are shorter). */
const ERASE_HORIZONTAL_SHARE = 0.6;
const ERASE_VERTICAL_SHARE = 0.75;
const ERASE_SEARCH_SHARE = 0.1;
const HANGUL_ONLY = /[^가-힣]/gu;
/** A Korean name has at least two syllables (a lone syllable is a stray mark or a team letter). */
const MIN_NAME_LENGTH = 2;

type TextBlockPass = { languages: OcrLanguage[]; pageSegMode: OcrPageSegMode };

/** Korean title "2026 년 10 월": as a block first, as one line when a handwritten note breaks the block. */
const TITLE_PASSES: TextBlockPass[] = [
  { languages: [OcrLanguage.KOREAN], pageSegMode: OcrPageSegMode.SINGLE_BLOCK },
  { languages: [OcrLanguage.KOREAN], pageSegMode: OcrPageSegMode.SINGLE_LINE },
];
/** English keeps the code letters of "D근무 07:00 ~ 16:00" (Korean OCR turns them into jamo). */
const LEGEND_PASSES: TextBlockPass[] = [
  { languages: [OcrLanguage.ENGLISH], pageSegMode: OcrPageSegMode.SINGLE_BLOCK },
];

/** First pass whose text `parse` accepts (passes run in order, later ones only when needed). */
const readTextBlock = async <T>(
  ocr: OcrProvider,
  gray: GrayImage,
  rect: PixelRect,
  scale: number,
  passes: TextBlockPass[],
  parse: (text: string) => T | null,
): Promise<T | null> => {
  const crop = cropGray(gray, rect);

  if (crop.width < 8 || crop.height < 8) {
    return null;
  }

  const image = await renderGrayPng(crop, scale);

  for (const pass of passes) {
    const parsed = parse((await ocr.recognize({ image, whitelist: null, ...pass })).text);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

type NameReading = { name: string | null; confidence: number | null };

const readNameColumn = async (
  ocr: OcrProvider,
  gray: GrayImage,
  grid: TableGrid,
  personRows: number[],
  column: number,
): Promise<NameReading[]> =>
  Promise.all(
    personRows.map(async (row) => {
      const cell = await prepareCell(gray, getCellRect(grid.rowLines, grid.columnLines, row, column), {
        inset: NAME_INSET,
        dropEnclosing: false,
      });
      const text = await readPreparedCell(ocr, cell, {
        languages: [OcrLanguage.KOREAN],
        whitelist: null,
        pageSegMode: OcrPageSegMode.SINGLE_LINE,
      });
      const name = text?.text.normalize('NFC').replace(HANGUL_ONLY, '') ?? '';

      return { name: name.length > 0 ? name : null, confidence: text?.confidence ?? null };
    }),
  );

const countNames = (readings: NameReading[]): number =>
  readings.filter((reading) => (reading.name?.length ?? 0) >= MIN_NAME_LENGTH).length;

/**
 * Names from the column before day 1 that reads the most Hangul names (a roster may put a number or a
 * team column next to the names); the first such column wins a tie. Only column 0 is read when day 1 is
 * in column 1, the usual layout.
 */
const readNames = async (
  ocr: OcrProvider,
  gray: GrayImage,
  grid: TableGrid,
  personRows: number[],
  dayOneColumn: number,
): Promise<NameReading[]> => {
  const columns = await Promise.all(
    Array.from({ length: Math.max(1, dayOneColumn) }, (_value, column) =>
      readNameColumn(ocr, gray, grid, personRows, column),
    ),
  );

  return columns.reduce((best, readings) => (countNames(readings) > countNames(best) ? readings : best));
};

/** Grid lines are erased for every cell read (title and legend are read from the untouched image). */
const eraseLinesOf = (gray: GrayImage, grid: TableGrid): GrayImage => {
  const spacing = (lines: number[]) => median(lines.slice(1).map((line, index) => line - lines[index]!)) ?? 0;
  const columnWidth = spacing(grid.columnLines);
  const rowHeight = spacing(grid.rowLines);

  return eraseGridLines(gray, grid.mask, {
    minHorizontalRun: Math.max(4, Math.round(columnWidth * ERASE_HORIZONTAL_SHARE)),
    minVerticalRun: Math.max(4, Math.round(rowHeight * ERASE_VERTICAL_SHARE)),
    searchPx: Math.max(3, Math.round(rowHeight * ERASE_SEARCH_SHARE)),
  });
};

/**
 * Days N: the header's validated count, extended toward the title month's length only over columns whose
 * header partially reads the day number (Spec §20-8); unconfirmed days are left unread.
 */
const resolveDayCount = (layout: HeaderLayout, grid: TableGrid, yearMonth: string | null): number => {
  const columnsAvailable = grid.columnLines.length - 1 - layout.dayOneColumn;

  if (yearMonth === null) {
    return layout.header.dayCount;
  }

  return extendDayCount(
    layout.header.dayCount,
    layout.dayTexts,
    Math.min(columnsAvailable, daysInMonth(yearMonth)),
  );
};

/**
 * AI-free table reading (Spec §20): table border → perspective flattening → grid lines → day header →
 * title month, legend, names and every person cell by OCR. Fails (for the hybrid to hand over to AI) when
 * no table, grid or day header is found.
 */
export const readOcrTable = async (source: RawImage, ocr: OcrProvider): Promise<OcrTableResult> => {
  const startedAt = performance.now();
  const geometry: OcrGeometry = { quad: null, warped: null, grid: null, headerRow: null };
  const fail = (failure: OcrTableFailure): OcrTableResult => ({
    ok: false,
    failure,
    geometry,
    latencyMs: Math.round(performance.now() - startedAt),
  });
  const detection = detectTableQuad(source);

  if (!detection) {
    return fail(OcrTableFailure.NO_TABLE);
  }

  geometry.quad = detection.quad;
  geometry.warped = warpTable(source, detection.quad);

  if (!geometry.warped) {
    return fail(OcrTableFailure.NO_TABLE);
  }

  const { warped } = geometry;
  const { gray } = warped.pixels;

  geometry.grid = detectGrid(warped);

  if (!geometry.grid) {
    return fail(OcrTableFailure.NO_GRID);
  }

  const { grid } = geometry;
  const cellGray = eraseLinesOf(gray, grid);
  const layout = await readHeaderLayout(ocr, cellGray, grid);

  if (!layout) {
    return fail(OcrTableFailure.NO_HEADER);
  }

  geometry.headerRow = layout.headerRow;

  const personRows = Array.from(
    { length: grid.rowLines.length - 1 - layout.firstPersonRow },
    (_value, index) => layout.firstPersonRow + index,
  );
  const table = warped.table;
  const tableWidth = table.right - table.left;
  const tableHeight = table.bottom - table.top;
  const rowHeight = tableHeight / Math.max(1, grid.rowLines.length - 1);
  const textScale = Math.max(1, TEXT_ROW_TARGET_PX / rowHeight);
  const titleRect = {
    left: table.left,
    top: Math.max(0, table.top - tableHeight * TITLE_HEIGHT_SHARE),
    right: table.left + tableWidth * TITLE_WIDTH_SHARE,
    bottom: grid.rowLines[layout.headerRow]!,
  };
  const legendRect = {
    left: table.left,
    top: grid.rowLines.at(-1)!,
    right: table.right,
    bottom: grid.rowLines.at(-1)! + tableHeight * LEGEND_HEIGHT_SHARE,
  };
  const [yearMonth, legendDefinitions] = await Promise.all([
    readTextBlock(ocr, gray, titleRect, textScale, TITLE_PASSES, parseTitleYearMonth),
    readTextBlock(ocr, gray, legendRect, textScale, LEGEND_PASSES, (text) => {
      const parsed = parseLegendDefinitions(text);

      return parsed.length > 0 ? parsed : null;
    }),
  ]);
  const legend = legendDefinitions ?? [];
  const dayCount = resolveDayCount(layout, grid, yearMonth);
  const [names, cellResult] = await Promise.all([
    readNames(ocr, cellGray, grid, personRows, layout.dayOneColumn),
    readPersonCells(
      ocr,
      cellGray,
      grid,
      layout,
      personRows,
      dayCount,
      legend.map((definition) => definition.code),
    ),
  ]);
  const rows: OcrRow[] = personRows.map((row, index) => ({
    index,
    rect: { left: table.left, right: table.right, top: grid.rowLines[row]!, bottom: grid.rowLines[row + 1]! },
    name: names[index]?.name ?? null,
    nameConfidence: names[index]?.confidence ?? null,
    cells: cellResult.cells[index] ?? [],
  }));
  const definitions: ShiftDefinition[] = [
    ...legend,
    ...(cellResult.dictionary.includes(OFF_CODE) && !legend.some((definition) => definition.code === OFF_CODE)
      ? [buildOffDefinition(OFF_CODE)]
      : []),
  ];

  return {
    ok: true,
    table: { yearMonth, dayCount, rows, definitions, dictionary: cellResult.dictionary },
    geometry,
    latencyMs: Math.round(performance.now() - startedAt),
  };
};

import { OcrLanguage } from '@/domain/enums/OcrLanguage';
import { OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';
import { type TableGrid } from '@/server/vision/ocr/GridDetector';
import { type GrayImage } from '@/server/vision/ocr/GrayRaster';
import { getCellRect, prepareCell, readPreparedCell } from '@/server/vision/ocr/OcrCellText';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import {
  type DayHeader,
  isWeekdayRow,
  KOREAN_WEEKDAYS,
  parseDayNumber,
  validateDayHeader,
} from '@/server/vision/ocr/HeaderValidator';

export type HeaderLayout = {
  /** Grid row holding the day numbers. */
  headerRow: number;
  /** First grid row of the person rows (after the weekday row when there is one). */
  firstPersonRow: number;
  /** Grid column of day 1. */
  dayOneColumn: number;
  header: DayHeader;
  /** Raw digit reading of every column from day 1 on (index = day − 1; '' when nothing was read). */
  dayTexts: string[];
};

/** The day-number row is searched among the first rows (a stray line above the table may come first). */
const HEADER_SEARCH_ROWS = 4;
/** Weekday detection samples the first week. */
const WEEKDAY_SAMPLE_DAYS = 7;
const CELL_INSET = 0.08;
const DIGITS = '0123456789';

const readDigitsRow = async (ocr: OcrProvider, gray: GrayImage, grid: TableGrid, row: number) =>
  Promise.all(
    grid.columnLines.slice(1, -1).map(async (_line, index) => {
      const cell = await prepareCell(gray, getCellRect(grid.rowLines, grid.columnLines, row, index + 1), {
        inset: CELL_INSET,
        dropEnclosing: false,
      });
      const text = await readPreparedCell(ocr, cell, {
        languages: [OcrLanguage.ENGLISH],
        whitelist: DIGITS,
        pageSegMode: OcrPageSegMode.SINGLE_LINE,
      });

      return text?.text ?? '';
    }),
  );

const readWeekdays = async (
  ocr: OcrProvider,
  gray: GrayImage,
  grid: TableGrid,
  row: number,
  dayOneColumn: number,
): Promise<string[]> =>
  Promise.all(
    Array.from({ length: WEEKDAY_SAMPLE_DAYS }, async (_value, index) => {
      const cell = await prepareCell(
        gray,
        getCellRect(grid.rowLines, grid.columnLines, row, dayOneColumn + index),
        {
          inset: CELL_INSET,
          dropEnclosing: false,
        },
      );
      const text = await readPreparedCell(ocr, cell, {
        languages: [OcrLanguage.KOREAN],
        whitelist: KOREAN_WEEKDAYS,
        pageSegMode: OcrPageSegMode.SINGLE_CHAR,
      });

      return text?.text ?? '';
    }),
  );

/**
 * Finds the day-number row (digit-whitelisted OCR of every column, contiguity 1…N validated) among the
 * first rows, then whether a weekday row follows (Spec §20). Columns before day 1 hold the name.
 */
export const readHeaderLayout = async (
  ocr: OcrProvider,
  gray: GrayImage,
  grid: TableGrid,
): Promise<HeaderLayout | null> => {
  const rowCount = grid.rowLines.length - 1;
  let best: { row: number; header: DayHeader; texts: string[] } | null = null;

  for (let row = 0; row < Math.min(HEADER_SEARCH_ROWS, rowCount); row += 1) {
    const texts = await readDigitsRow(ocr, gray, grid, row);
    const header = validateDayHeader(texts.map(parseDayNumber));

    if (header && (!best || header.matchedDays > best.header.matchedDays)) {
      best = { row, header, texts };
    }
  }

  if (!best) {
    return null;
  }

  const dayOneColumn = best.header.firstColumn + 1;
  const weekdayRow = best.row + 1;
  const hasWeekdays =
    weekdayRow < rowCount && isWeekdayRow(await readWeekdays(ocr, gray, grid, weekdayRow, dayOneColumn));

  return {
    headerRow: best.row,
    firstPersonRow: hasWeekdays ? weekdayRow + 1 : weekdayRow,
    dayOneColumn,
    header: best.header,
    // Header texts start at grid column 1 (column 0 is never a day).
    dayTexts: best.texts.slice(dayOneColumn - 1),
  };
};

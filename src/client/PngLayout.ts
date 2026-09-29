import { formatDateTime, formatLegendText } from '@/client/DisplayText';
import { buildMonthWeeks, WEEKDAY_LABELS } from '@/client/MonthLayout';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type PngRenderInput } from '@/domain/types/PngRenderInput';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { formatYearMonthLabel, listDates } from '@/domain/YearMonth';

/** CSS pixel width of the exported image; the canvas is drawn at PNG_SCALE for sharp text. */
export const PNG_WIDTH = 1080;
export const PNG_SCALE = 2;

/** Font weights the renderer draws with. */
export const PNG_WEIGHTS = [400, 500, 600];

const WORDMARK = '오프날';

export const buildPngTitle = (data: PngRenderInput): string =>
  `${data.displayName} · ${formatYearMonthLabel(data.yearMonth)}`;

export const buildFooterText = (generatedAt: string): string => `생성 ${formatDateTime(generatedAt)}`;

/** The month a share-link recipient is viewing, as renderer input; null when nothing is visible. */
export const buildSharedPngInput = (
  data: SharedCalendarResponse,
  generatedAt: Date,
): PngRenderInput | null => {
  if (!data.month) {
    return null;
  }

  return {
    displayName: data.displayName,
    yearMonth: data.month.yearMonth,
    definitions: data.month.definitions,
    entries: data.month.entries.map((entry) => ({ date: entry.date, code: entry.code })),
    generatedAt: generatedAt.toISOString(),
  };
};

export const buildSharedPngFilename = (yearMonth: string): string => `offnal-shared-${yearMonth}.png`;

const DIGITS = '0123456789–';

/**
 * Every string the renderer draws, grouped by font weight, so each weight's font subset can be loaded
 * for exactly those glyphs before drawing (names and custom labels are arbitrary Korean text).
 */
export const collectPngTexts = (data: PngRenderInput, legend: ShiftDefinition[]): Record<number, string> => {
  const codes = data.entries.map((entry) => entry.code ?? '').join('');
  const dayNumbers = listDates(data.yearMonth).join('');

  return {
    400: `${legend.map(formatLegendText).join('')}${buildFooterText(data.generatedAt)}${DIGITS}`,
    500: `${WEEKDAY_LABELS.join('')}${dayNumbers}${DIGITS}`,
    600: `${WORDMARK}${buildPngTitle(data)}${codes}${legend.map((definition) => definition.code).join('')}${DIGITS}`,
  };
};

const PADDING = 64;
const HEADER_HEIGHT = 190;
const WEEKDAY_ROW_HEIGHT = 56;
const CELL_HEIGHT = 132;
const LEGEND_GAP = 40;
const LEGEND_ROW_HEIGHT = 48;
const FOOTER_HEIGHT = 96;

export type PngCell = {
  date: string;
  x: number;
  y: number;
};

export type PngLayout = {
  width: number;
  height: number;
  padding: number;
  wordmarkY: number;
  titleY: number;
  weekdayY: number;
  gridLeft: number;
  gridTop: number;
  cellWidth: number;
  cellHeight: number;
  cells: PngCell[];
  legendTop: number;
  legendRowHeight: number;
  footerY: number;
};

/** Pure geometry of the month image (no canvas access), so it can be unit-tested. */
export const computePngLayout = (yearMonth: string, legendCount: number): PngLayout => {
  const weeks = buildMonthWeeks(yearMonth);
  const gridLeft = PADDING;
  const cellWidth = (PNG_WIDTH - PADDING * 2) / 7;
  const weekdayY = PADDING + HEADER_HEIGHT;
  const gridTop = weekdayY + WEEKDAY_ROW_HEIGHT;
  const cells: PngCell[] = [];

  weeks.forEach((week, row) => {
    week.forEach((date, column) => {
      if (date !== null) {
        cells.push({ date, x: gridLeft + column * cellWidth, y: gridTop + row * CELL_HEIGHT });
      }
    });
  });

  const legendTop = gridTop + weeks.length * CELL_HEIGHT + LEGEND_GAP;
  const legendBottom = legendTop + Math.max(1, legendCount) * LEGEND_ROW_HEIGHT;
  const footerY = legendBottom + FOOTER_HEIGHT / 2;

  return {
    width: PNG_WIDTH,
    height: legendBottom + FOOTER_HEIGHT,
    padding: PADDING,
    wordmarkY: PADDING + 36,
    titleY: PADDING + 120,
    weekdayY,
    gridLeft,
    gridTop,
    cellWidth,
    cellHeight: CELL_HEIGHT,
    cells,
    legendTop,
    legendRowHeight: LEGEND_ROW_HEIGHT,
    footerY,
  };
};

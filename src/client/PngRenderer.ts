import { formatDateTime, formatShiftTime } from '@/client/DisplayText';
import { WEEKDAY_LABELS } from '@/client/MonthLayout';
import { computePngLayout, PNG_SCALE, type PngLayout } from '@/client/PngLayout';
import { getShiftTone } from '@/client/ShiftStyle';
import { ShiftTone } from '@/domain/enums/ShiftTone';
import { type ExportDataResponse } from '@/domain/types/api/ExportDataResponse';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { dayOfDate, formatYearMonthLabel } from '@/domain/YearMonth';

/** Always the light palette: the image must read the same regardless of the viewer's theme. */
const COLORS = {
  background: '#ffffff',
  ink: '#172034',
  sub: '#667085',
  line: '#e7ebf2',
  blue: '#3155e7',
  sunday: '#c0362c',
};

const TONE_COLORS: Record<ShiftTone, { ink: string; fill: string }> = {
  [ShiftTone.DAY]: { ink: '#2455be', fill: '#e9f1ff' },
  [ShiftTone.EVENING]: { ink: '#7844a7', fill: '#f1e9fa' },
  [ShiftTone.NIGHT]: { ink: '#384c79', fill: '#e5eaf4' },
  [ShiftTone.MIDDLE]: { ink: '#8c611f', fill: '#fff0d8' },
  [ShiftTone.OFF]: { ink: '#667085', fill: '#f4f6fb' },
  [ShiftTone.CUSTOM]: { ink: '#172034', fill: '#eef0f4' },
  [ShiftTone.UNKNOWN]: { ink: '#99550d', fill: '#fff0dc' },
};

const FALLBACK_FONT = "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

const getAppFontFamily = (): string => {
  const family = getComputedStyle(document.body).fontFamily;

  return family || FALLBACK_FONT;
};

/** Waits for the app web font (Korean glyphs) so the canvas never falls back mid-render. */
const waitForFonts = async (family: string): Promise<void> => {
  if (!('fonts' in document)) {
    return;
  }

  await Promise.all([
    document.fonts.load(`400 32px ${family}`, '오프날 근무 0123'),
    document.fonts.load(`600 32px ${family}`, '오프날 근무 0123'),
  ]).catch(() => undefined);
  await document.fonts.ready;
};

const roundRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
};

/** Shrinks the font until the text fits (long custom codes, long names). */
const fitText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  size: number,
  family: string,
) => {
  let current = size;

  context.font = `${weight} ${current}px ${family}`;

  while (context.measureText(text).width > maxWidth && current > 12) {
    current -= 2;
    context.font = `${weight} ${current}px ${family}`;
  }
};

const drawHeader = (
  context: CanvasRenderingContext2D,
  layout: PngLayout,
  data: ExportDataResponse,
  family: string,
) => {
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.font = `600 36px ${family}`;
  context.fillStyle = COLORS.ink;
  context.fillText('오프', layout.padding, layout.wordmarkY);

  const offWidth = context.measureText('오프').width;

  context.fillStyle = COLORS.blue;
  context.fillText('날', layout.padding + offWidth, layout.wordmarkY);
  context.fillStyle = COLORS.ink;
  fitText(
    context,
    `${data.displayName} · ${formatYearMonthLabel(data.yearMonth)}`,
    layout.width - layout.padding * 2,
    600,
    56,
    family,
  );
  context.fillText(
    `${data.displayName} · ${formatYearMonthLabel(data.yearMonth)}`,
    layout.padding,
    layout.titleY,
  );
};

const drawWeekdays = (context: CanvasRenderingContext2D, layout: PngLayout, family: string) => {
  context.font = `500 28px ${family}`;
  context.textAlign = 'center';
  WEEKDAY_LABELS.forEach((label, column) => {
    context.fillStyle = column === 0 ? COLORS.sunday : COLORS.sub;
    context.fillText(
      label,
      layout.gridLeft + column * layout.cellWidth + layout.cellWidth / 2,
      layout.weekdayY + 36,
    );
  });
};

const drawCells = (
  context: CanvasRenderingContext2D,
  layout: PngLayout,
  data: ExportDataResponse,
  family: string,
) => {
  const codeByDate = new Map(data.entries.map((entry) => [entry.date, entry.code]));

  for (const cell of layout.cells) {
    const centerX = cell.x + layout.cellWidth / 2;
    const code = codeByDate.get(cell.date) ?? null;
    const tone = TONE_COLORS[getShiftTone(code, data.definitions)];
    const badgeWidth = layout.cellWidth - 24;

    context.fillStyle = COLORS.line;
    context.fillRect(cell.x + 6, cell.y, layout.cellWidth - 12, 2);
    context.textAlign = 'center';
    context.font = `500 30px ${family}`;
    context.fillStyle = COLORS.ink;
    context.fillText(String(dayOfDate(cell.date)), centerX, cell.y + 44);
    context.fillStyle = tone.fill;
    roundRect(context, cell.x + 12, cell.y + 62, badgeWidth, 46, 10);
    context.fillStyle = tone.ink;
    fitText(context, code ?? '–', badgeWidth - 10, 600, 28, family);
    context.fillText(code ?? '–', centerX, cell.y + 95);
  }
};

const drawLegend = (
  context: CanvasRenderingContext2D,
  layout: PngLayout,
  definitions: ShiftDefinition[],
  family: string,
) => {
  context.textAlign = 'left';
  definitions.forEach((definition, index) => {
    const y = layout.legendTop + index * layout.legendRowHeight;
    const tone = TONE_COLORS[getShiftTone(definition.code, definitions)];
    const text = `${definition.label} · ${formatShiftTime(definition)}`;

    context.fillStyle = tone.fill;
    roundRect(context, layout.padding, y, 120, 38, 8);
    context.fillStyle = tone.ink;
    context.textAlign = 'center';
    fitText(context, definition.code, 110, 600, 24, family);
    context.fillText(definition.code, layout.padding + 60, y + 28);
    context.textAlign = 'left';
    context.fillStyle = COLORS.ink;
    fitText(context, text, layout.width - layout.padding * 2 - 140, 400, 26, family);
    context.fillText(text, layout.padding + 140, y + 28);
  });
};

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });

/** Renders the owner's published month (from export-data only) into a PNG blob. */
export const renderMonthPng = async (data: ExportDataResponse): Promise<Blob> => {
  const family = getAppFontFamily();

  await waitForFonts(family);

  const usedCodes = new Set(data.entries.map((entry) => entry.code));
  const legend = data.definitions.filter((definition) => usedCodes.has(definition.code));
  const layout = computePngLayout(data.yearMonth, legend.length);
  const canvas = document.createElement('canvas');

  canvas.width = layout.width * PNG_SCALE;
  canvas.height = layout.height * PNG_SCALE;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is not available');
  }

  context.scale(PNG_SCALE, PNG_SCALE);
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, layout.width, layout.height);
  drawHeader(context, layout, data, family);
  drawWeekdays(context, layout, family);
  drawCells(context, layout, data, family);
  drawLegend(context, layout, legend, family);
  context.textAlign = 'left';
  context.font = `400 24px ${family}`;
  context.fillStyle = COLORS.sub;
  context.fillText(`생성 ${formatDateTime(data.generatedAt)}`, layout.padding, layout.footerY);

  return toBlob(canvas);
};

export const buildPngFilename = (yearMonth: string): string => `offnal-${yearMonth}.png`;

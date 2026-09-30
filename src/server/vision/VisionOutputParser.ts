import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionTableOutcome } from '@/domain/enums/VisionTableOutcome';
import { alignCellsToMonth } from '@/domain/ScheduleValidator';
import { type GridCorners } from '@/domain/types/GridCorners';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type TableRecognitionResult } from '@/domain/types/TableRecognitionResult';
import {
  gridOutputSchema,
  personOutputSchema,
  rowLocationOutputSchema,
  sanitizeDefinition,
  sanitizeYearMonth,
  stripPersonOutputSchema,
  tableOutputSchema,
} from '@/server/vision/VisionPrompts';
import {
  type PersonExtractionInput,
  type RowBand,
  VisionProviderError,
} from '@/server/vision/VisionProvider';

const FAILURE_BY_OUTCOME: Record<VisionTableOutcome, RecognitionErrorCode | null> = {
  [VisionTableOutcome.OK]: null,
  [VisionTableOutcome.NO_TABLE]: RecognitionErrorCode.NO_TABLE,
  [VisionTableOutcome.UNREADABLE]: RecognitionErrorCode.UNREADABLE,
  [VisionTableOutcome.NO_NAMES]: RecognitionErrorCode.NO_NAMES,
};

/** Grid corners, or null when absent/malformed/non-finite (geometry is checked by PerspectiveWarp). */
export const parseGrid = (raw: unknown): GridCorners | null => {
  const parsed = gridOutputSchema.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  const corners = [
    parsed.data.topLeft,
    parsed.data.topRight,
    parsed.data.bottomRight,
    parsed.data.bottomLeft,
  ];

  return corners.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ? parsed.data : null;
};

/** Re-validates first-pass model JSON (shared by every real provider). Throws PROVIDER_ERROR on mismatch. */
export const parseTableOutput = (raw: unknown): TableRecognitionResult => {
  const parsed = tableOutputSchema.safeParse(raw);

  if (!parsed.success) {
    throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
  }

  const failure = FAILURE_BY_OUTCOME[parsed.data.outcome];

  if (failure) {
    return { ok: false, errorCode: failure };
  }

  const seenRowIds = new Set<string>();
  const candidates = parsed.data.candidates.flatMap((candidate) => {
    const rowId = candidate.rowId.trim();
    const name = candidate.name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);

    if (!rowId || !name || seenRowIds.has(rowId)) {
      return [];
    }

    seenRowIds.add(rowId);

    return [{ rowId, name }];
  });

  if (candidates.length === 0) {
    return { ok: false, errorCode: RecognitionErrorCode.NO_NAMES };
  }

  return {
    ok: true,
    value: {
      yearMonth: sanitizeYearMonth(parsed.data.yearMonth),
      candidates,
      definitions: parsed.data.definitions.map(sanitizeDefinition),
      dayHeaders: parsed.data.dayHeaders.filter((header) => header.day >= 1 && header.day <= 31),
      grid: parseGrid(parsed.data.grid),
    },
  };
};

/** Re-validates second-pass model JSON. Throws PROVIDER_ERROR on mismatch. */
export const parsePersonOutput = (raw: unknown, input: PersonExtractionInput): PersonExtraction => {
  const parsed = personOutputSchema.safeParse(raw);

  if (!parsed.success) {
    throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
  }

  return {
    yearMonth: input.yearMonth,
    rowId: input.rowId,
    displayName: input.name,
    definitions: parsed.data.definitions.map(sanitizeDefinition),
    cells: parsed.data.cells,
  };
};

/** Re-validates `locateRow` JSON. Null top/bottom = row not found; the band's geometry is checked by RowStrip. */
export const parseRowLocationOutput = (raw: unknown): RowBand | null => {
  const parsed = rowLocationOutputSchema.safeParse(raw);

  if (!parsed.success) {
    throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
  }

  const { top, bottom, headerBottom } = parsed.data;

  return top === null || bottom === null ? null : { top, bottom, headerBottom };
};

/**
 * Re-validates strip extraction JSON: cells are aligned to day 1…N by position (count checked), and the
 * legend is pass 1's (the strip does not show it).
 */
export const parseStripPersonOutput = (raw: unknown, input: PersonExtractionInput): PersonExtraction => {
  const parsed = stripPersonOutputSchema.safeParse(raw);

  if (!parsed.success) {
    throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
  }

  return {
    yearMonth: input.yearMonth,
    rowId: input.rowId,
    displayName: input.name,
    definitions: input.definitions.map((definition) => ({ ...definition })),
    cells: alignCellsToMonth(parsed.data.cells, input.yearMonth).cells,
  };
};

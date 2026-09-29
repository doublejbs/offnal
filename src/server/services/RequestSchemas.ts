import { z } from 'zod';

import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { isValidCode } from '@/domain/ScheduleValidator';
import { isValidTime } from '@/domain/ShiftTime';
import { isValidDate, isValidYearMonth } from '@/domain/YearMonth';

export const MAX_LABEL_LENGTH = 20;
export const MAX_DISPLAY_NAME_LENGTH = 40;

const MAX_DEFINITIONS = 40;
const MAX_DAYS_IN_MONTH = 31;
const MAX_ROW_ID_LENGTH = 64;

const timeSchema = z.string().refine(isValidTime).nullable();

export const yearMonthSchema = z.string().refine(isValidYearMonth);

export const displayNameSchema = z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH);

export const shiftDefinitionSchema = z.object({
  code: z.string().refine(isValidCode),
  label: z.string().trim().min(1).max(MAX_LABEL_LENGTH),
  startTime: timeSchema,
  endTime: timeSchema,
  endsNextDay: z.boolean().nullable(),
  isOff: z.boolean(),
});

export const shiftEntrySchema = z.object({
  date: z.string().refine(isValidDate),
  code: z.string().refine(isValidCode).nullable(),
  reviewReasons: z.array(z.enum(ShiftReviewReason)).max(Object.values(ShiftReviewReason).length),
  confirmed: z.boolean(),
});

/** PATCH /api/drafts/:id — see PatchDraftRequest. */
export const patchDraftRequestSchema = z.object({
  revision: z.number().int().positive(),
  displayName: displayNameSchema.optional(),
  yearMonth: yearMonthSchema.optional(),
  entries: z.array(shiftEntrySchema).max(MAX_DAYS_IN_MONTH).optional(),
  definitions: z
    .array(shiftDefinitionSchema)
    .max(MAX_DEFINITIONS)
    .refine(
      (definitions) => new Set(definitions.map((definition) => definition.code)).size === definitions.length,
    )
    .optional(),
});

export const publishDraftRequestSchema = z.object({ revision: z.number().int().positive() });

export const extractRecognitionRequestSchema = z.union([
  z.strictObject({ rowId: z.string().min(1).max(MAX_ROW_ID_LENGTH), yearMonth: yearMonthSchema }),
  z.strictObject({ manualName: displayNameSchema, yearMonth: yearMonthSchema }),
]);

export const devLoginRequestSchema = z.object({
  displayName: z.string().max(200).optional(),
  returnTo: z.string().max(2000).optional(),
});

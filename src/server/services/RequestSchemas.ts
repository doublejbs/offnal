import { z } from 'zod';

import { MAX_DISPLAY_NAME_LENGTH, MAX_LABEL_LENGTH } from '@/domain/DomainLimits';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { isValidCode } from '@/domain/ScheduleValidator';
import { isValidTime } from '@/domain/ShiftTime';
import { type DevLoginRequest } from '@/domain/types/api/DevLoginRequest';
import { type ExtractRecognitionRequest } from '@/domain/types/api/ExtractRecognitionRequest';
import { type PatchDraftRequest } from '@/domain/types/api/PatchDraftRequest';
import { type PublishDraftRequest } from '@/domain/types/api/PublishDraftRequest';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { isValidDate, isValidYearMonth } from '@/domain/YearMonth';

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
}) satisfies z.ZodType<ShiftDefinition>;

export const shiftEntrySchema = z.object({
  date: z.string().refine(isValidDate),
  code: z.string().refine(isValidCode).nullable(),
  reviewReasons: z.array(z.enum(ShiftReviewReason)).max(Object.values(ShiftReviewReason).length),
  confirmed: z.boolean(),
}) satisfies z.ZodType<ShiftEntry>;

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
}) satisfies z.ZodType<PatchDraftRequest>;

export const publishDraftRequestSchema = z.object({
  revision: z.number().int().positive(),
}) satisfies z.ZodType<PublishDraftRequest>;

export const extractRecognitionRequestSchema = z.union([
  z.strictObject({ rowId: z.string().min(1).max(MAX_ROW_ID_LENGTH), yearMonth: yearMonthSchema }),
  z.strictObject({ manualName: displayNameSchema, yearMonth: yearMonthSchema }),
]) satisfies z.ZodType<ExtractRecognitionRequest>;

export const devLoginRequestSchema = z.object({
  displayName: z.string().max(200).optional(),
  returnTo: z.string().max(2000).optional(),
}) satisfies z.ZodType<DevLoginRequest>;

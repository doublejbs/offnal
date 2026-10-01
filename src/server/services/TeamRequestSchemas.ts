import 'server-only';

import { z } from 'zod';

import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type AckTeamChangesRequest } from '@/domain/types/api/AckTeamChangesRequest';
import { type ApproveTeamMemberRequest } from '@/domain/types/api/ApproveTeamMemberRequest';
import { type CreateTeamInviteRequest } from '@/domain/types/api/CreateTeamInviteRequest';
import { type CreateTeamRequest } from '@/domain/types/api/CreateTeamRequest';
import { type ExtractNextRequest } from '@/domain/types/api/ExtractNextRequest';
import { type JoinTeamRequest } from '@/domain/types/api/JoinTeamRequest';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type PublishTeamRosterRequest } from '@/domain/types/api/PublishTeamRosterRequest';
import { type UpdateTeamMemberRequest } from '@/domain/types/api/UpdateTeamMemberRequest';
import { type UpdateTeamRequest } from '@/domain/types/api/UpdateTeamRequest';
import {
  displayNameSchema,
  shiftDefinitionSchema,
  shiftEntrySchema,
  yearMonthSchema,
} from '@/server/services/RequestSchemas';

export const MAX_TEAM_NAME_LENGTH = MAX_DISPLAY_NAME_LENGTH;
export const DEFAULT_INVITE_DAYS = 14;
export const MAX_INVITE_DAYS = 30;
/** Upper bound of people in one roster (pass-1 candidates beyond it are ignored). */
export const MAX_ROSTER_ROWS = 80;

const MAX_DEFINITIONS = 40;
const MAX_DAYS_IN_MONTH = 31;
const MAX_ROW_KEY_LENGTH = 80;
const MAX_INVITE_USES = 1000;
const MAX_REVISION = 100_000;

const teamNameSchema = z.string().trim().min(1).max(MAX_TEAM_NAME_LENGTH);

export const rowKeySchema = z.string().min(1).max(MAX_ROW_KEY_LENGTH);

export const createTeamRequestSchema = z.strictObject({
  name: teamNameSchema,
}) satisfies z.ZodType<CreateTeamRequest>;

export const updateTeamRequestSchema = z.strictObject({
  name: teamNameSchema.optional(),
  shareRosterWithMembers: z.boolean().optional(),
}) satisfies z.ZodType<UpdateTeamRequest>;

export const createTeamInviteRequestSchema = z.strictObject({
  expiresInDays: z.number().int().min(1).max(MAX_INVITE_DAYS).optional(),
  maxUses: z.number().int().min(1).max(MAX_INVITE_USES).nullable().optional(),
}) satisfies z.ZodType<CreateTeamInviteRequest>;

export const joinTeamRequestSchema = z.strictObject({
  rowKey: rowKeySchema.nullable(),
}) satisfies z.ZodType<JoinTeamRequest>;

export const approveTeamMemberRequestSchema = z.strictObject({
  rowKey: rowKeySchema.nullable().optional(),
}) satisfies z.ZodType<ApproveTeamMemberRequest>;

export const updateTeamMemberRequestSchema = z.strictObject({
  rowKey: rowKeySchema.nullable().optional(),
  role: z.enum(TeamRole).optional(),
}) satisfies z.ZodType<UpdateTeamMemberRequest>;

export const extractNextRequestSchema = z.strictObject({
  retryFailed: z.boolean().optional(),
}) satisfies z.ZodType<ExtractNextRequest>;

const rosterVersionSchema = z.number().int().positive();

const entriesSchema = z.array(shiftEntrySchema).max(MAX_DAYS_IN_MONTH);

export const patchTeamRosterRequestSchema = z.strictObject({
  version: rosterVersionSchema,
  yearMonth: yearMonthSchema.optional(),
  definitions: z
    .array(shiftDefinitionSchema)
    .max(MAX_DEFINITIONS)
    .refine(
      (definitions) => new Set(definitions.map((definition) => definition.code)).size === definitions.length,
    )
    .optional(),
  rows: z
    .array(
      z.strictObject({
        rowId: z.uuid(),
        displayName: displayNameSchema.optional(),
        entries: entriesSchema.optional(),
        excluded: z.boolean().optional(),
        matchRowKey: rowKeySchema.optional(),
      }),
    )
    .max(MAX_ROSTER_ROWS)
    .optional(),
  addRows: z
    .array(z.strictObject({ displayName: displayNameSchema, entries: entriesSchema.optional() }))
    .max(MAX_ROSTER_ROWS)
    .optional(),
}) satisfies z.ZodType<PatchTeamRosterRequest>;

export const publishTeamRosterRequestSchema = z.strictObject({
  version: rosterVersionSchema,
  confirmUnlinked: z.boolean().optional(),
}) satisfies z.ZodType<PublishTeamRosterRequest>;

export const ackTeamChangesRequestSchema = z.strictObject({
  yearMonth: yearMonthSchema,
  revision: z.number().int().min(0).max(MAX_REVISION),
}) satisfies z.ZodType<AckTeamChangesRequest>;

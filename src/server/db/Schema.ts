import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { AuthIdentityProvider } from '@/domain/enums/AuthIdentityProvider';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { type ImageMimeType } from '@/domain/enums/ImageMimeType';
import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';
import { type TableRecognition } from '@/domain/types/TableRecognition';

const YEAR_MONTH_REGEX = '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$';

const buildCreatedAtColumn = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

const buildUpdatedAtColumn = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const buildYearMonthCheck = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ ${sql.raw(`'${YEAR_MONTH_REGEX}'`)}`);

const buildEnumValueList = (values: Record<string, string>): SQL =>
  sql.raw(
    Object.values(values)
      .map((value) => `'${value.replace(/'/g, "''")}'`)
      .join(', '),
  );

const buildEnumCheck = (name: string, column: AnyPgColumn, values: Record<string, string>) =>
  check(name, sql`${column} in (${buildEnumValueList(values)})`);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Seoul'),
  createdAt: buildCreatedAtColumn(),
});

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<AuthIdentityProvider>().notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: text('email'),
    createdAt: buildCreatedAtColumn(),
  },
  (table) => [
    unique('auth_identities_provider_subject_unique').on(table.provider, table.providerSubject),
    buildEnumCheck('auth_identities_provider_check', table.provider, AuthIdentityProvider),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    /** sha256(token) hex */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: buildCreatedAtColumn(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const anonymousSessions = pgTable('anonymous_sessions', {
  /** sha256(token) hex */
  id: text('id').primaryKey(),
  ipHash: text('ip_hash'),
  createdAt: buildCreatedAtColumn(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const recognitionJobs = pgTable(
  'recognition_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    anonymousSessionId: text('anonymous_session_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<RecognitionStatus>().notNull(),
    errorCode: text('error_code').$type<RecognitionErrorCode>(),
    sourceObjectKey: text('source_object_key'),
    sourceMime: text('source_mime').$type<ImageMimeType>().notNull(),
    sourceDeletedAt: timestamp('source_deleted_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    /** Temporary: contains other people's names. Cleared on expiry. */
    tableResult: jsonb('table_result').$type<TableRecognition>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: buildCreatedAtColumn(),
    updatedAt: buildUpdatedAtColumn(),
  },
  (table) => [
    index('recognition_jobs_user_id_idx').on(table.userId),
    index('recognition_jobs_anonymous_session_id_idx').on(table.anonymousSessionId),
    buildEnumCheck('recognition_jobs_status_check', table.status, RecognitionStatus),
    buildEnumCheck('recognition_jobs_error_code_check', table.errorCode, RecognitionErrorCode),
  ],
);

export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recognitionJobId: uuid('recognition_job_id').references(() => recognitionJobs.id, {
      onDelete: 'set null',
    }),
    personRowId: text('person_row_id'),
    yearMonth: text('year_month').notNull(),
    displayName: text('display_name').notNull(),
    definitions: jsonb('definitions').$type<ShiftDefinition[]>().notNull(),
    entries: jsonb('entries').$type<ShiftEntry[]>().notNull(),
    sourceCells: jsonb('source_cells').$type<SourceCell[]>().notNull().default([]),
    status: text('status').$type<DraftStatus>().notNull(),
    revision: integer('revision').notNull().default(1),
    /** published_months.revision this draft was copied from (edit drafts only); guards stale overwrites. */
    basePublishedRevision: integer('base_published_revision'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: buildCreatedAtColumn(),
    updatedAt: buildUpdatedAtColumn(),
  },
  (table) => [
    index('drafts_user_id_idx').on(table.userId),
    uniqueIndex('drafts_job_row_month_unique')
      .on(table.recognitionJobId, table.personRowId, table.yearMonth)
      .where(sql`${table.recognitionJobId} is not null`),
    buildYearMonthCheck('drafts_year_month_check', table.yearMonth),
    buildEnumCheck('drafts_status_check', table.status, DraftStatus),
  ],
);

export const calendars = pgTable('calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .unique('calendars_owner_id_unique')
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  shareEnabled: boolean('share_enabled').notNull().default(false),
  shareTokenHash: text('share_token_hash').unique('calendars_share_token_hash_unique'),
  shareTokenCiphertext: text('share_token_ciphertext'),
  shareRotatedAt: timestamp('share_rotated_at', { withTimezone: true }),
  createdAt: buildCreatedAtColumn(),
  updatedAt: buildUpdatedAtColumn(),
});

export const publishedMonths = pgTable(
  'published_months',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(),
    revision: integer('revision').notNull().default(1),
    shareVisible: boolean('share_visible').notNull().default(false),
    /** Monthly snapshot so past months never change when definitions change elsewhere. */
    definitions: jsonb('definitions').$type<ShiftDefinition[]>().notNull(),
    entries: jsonb('entries').$type<ShiftEntry[]>().notNull(),
    sourceDraftId: uuid('source_draft_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: buildUpdatedAtColumn(),
  },
  (table) => [
    unique('published_months_calendar_month_unique').on(table.calendarId, table.yearMonth),
    buildYearMonthCheck('published_months_year_month_check', table.yearMonth),
  ],
);

export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(),
    source: text('source').$type<EntitlementSource>().notNull(),
    paymentId: uuid('payment_id'),
    createdAt: buildCreatedAtColumn(),
  },
  (table) => [
    unique('entitlements_user_month_unique').on(table.userId, table.yearMonth),
    buildYearMonthCheck('entitlements_year_month_check', table.yearMonth),
    buildEnumCheck('entitlements_source_check', table.source, EntitlementSource),
  ],
);

export const payments = pgTable(
  'payments',
  {
    /** Also used as the provider order ID. */
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('KRW'),
    provider: text('provider').$type<PaymentProviderType>().notNull(),
    providerPaymentKey: text('provider_payment_key').unique('payments_provider_payment_key_unique'),
    status: text('status').$type<PaymentStatus>().notNull(),
    failureCode: text('failure_code'),
    draftId: uuid('draft_id'),
    createdAt: buildCreatedAtColumn(),
    updatedAt: buildUpdatedAtColumn(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [
    index('payments_user_month_idx').on(table.userId, table.yearMonth),
    buildYearMonthCheck('payments_year_month_check', table.yearMonth),
    buildEnumCheck('payments_provider_check', table.provider, PaymentProviderType),
    buildEnumCheck('payments_status_check', table.status, PaymentStatus),
  ],
);

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').$type<PaymentProviderType>().notNull(),
    eventKey: text('event_key').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    unique('payment_events_provider_event_key_unique').on(table.provider, table.eventKey),
    buildEnumCheck('payment_events_provider_check', table.provider, PaymentProviderType),
  ],
);

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** Team spec §4: active members see the whole published roster unless an admin turns this off. */
  shareRosterWithMembers: boolean('share_roster_with_members').notNull().default(true),
  createdAt: buildCreatedAtColumn(),
  updatedAt: buildUpdatedAtColumn(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<TeamRole>().notNull(),
    status: text('status').$type<TeamMemberStatus>().notNull(),
    /** Roster row (row_key) this member's calendar shows; null until linked. */
    linkedRowKey: text('linked_row_key'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    updatedAt: buildUpdatedAtColumn(),
  },
  (table) => [
    unique('team_members_team_user_unique').on(table.teamId, table.userId),
    index('team_members_user_id_idx').on(table.userId),
    // One active member per roster row.
    uniqueIndex('team_members_active_row_unique')
      .on(table.teamId, table.linkedRowKey)
      .where(sql`${table.status} = 'active' and ${table.linkedRowKey} is not null`),
    buildEnumCheck('team_members_role_check', table.role, TeamRole),
    buildEnumCheck('team_members_status_check', table.status, TeamMemberStatus),
  ],
);

export const teamInvites = pgTable(
  'team_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    /** sha256(token) hex; the token itself is only in the issue response. */
    tokenHash: text('token_hash').notNull().unique('team_invites_token_hash_unique'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    createdAt: buildCreatedAtColumn(),
  },
  (table) => [
    index('team_invites_team_id_idx').on(table.teamId),
    check('team_invites_max_uses_check', sql`${table.maxUses} is null or ${table.maxUses} > 0`),
  ],
);

export const teamRosters = pgTable(
  'team_rosters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    /** Null only while the first pass of an upload has not produced a month yet. */
    yearMonth: text('year_month'),
    status: text('status').$type<TeamRosterStatus>().notNull(),
    /** Published revision number of the month (1, 2, …); null while DRAFT. */
    revision: integer('revision'),
    /** Latest published revision of the month when this draft was created (0 = none); guards stale publishes. */
    baseRevision: integer('base_revision').notNull().default(0),
    /** Optimistic-lock counter for PATCH (409 on mismatch). */
    version: integer('version').notNull().default(1),
    sourceJobId: uuid('source_job_id').references(() => recognitionJobs.id, { onDelete: 'set null' }),
    /** Team-wide code definitions of this roster (one legend for every row). */
    definitions: jsonb('definitions').$type<ShiftDefinition[]>().notNull().default([]),
    /** Set once rows were created from the first pass (upload drafts) or copied (edit/revert). */
    rowsCreatedAt: timestamp('rows_created_at', { withTimezone: true }),
    /** Admin's "이 근무표를 팀에 공유할 권한이 있어요" consent time (uploads). */
    authorityConfirmedAt: timestamp('authority_confirmed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: buildCreatedAtColumn(),
    updatedAt: buildUpdatedAtColumn(),
  },
  (table) => [
    unique('team_rosters_team_month_revision_unique').on(table.teamId, table.yearMonth, table.revision),
    uniqueIndex('team_rosters_published_unique')
      .on(table.teamId, table.yearMonth)
      .where(sql`${table.status} = 'published'`),
    // Cleanup and personal-API exclusion look rosters up by their upload job.
    index('team_rosters_source_job_id_idx').on(table.sourceJobId),
    buildYearMonthCheck('team_rosters_year_month_check', table.yearMonth),
    buildEnumCheck('team_rosters_status_check', table.status, TeamRosterStatus),
    check('team_rosters_revision_check', sql`(${table.status} = 'draft') = (${table.revision} is null)`),
  ],
);

export const teamRosterRows = pgTable(
  'team_roster_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rosterId: uuid('roster_id')
      .notNull()
      .references(() => teamRosters.id, { onDelete: 'cascade' }),
    /** Person key across revisions of a team month: normalized name + same-name ordinal. */
    rowKey: text('row_key').notNull(),
    displayName: text('display_name').notNull(),
    sameNameOrdinal: integer('same_name_ordinal').notNull().default(1),
    /** Display order (pass-1 order, manual rows appended). */
    position: integer('position').notNull(),
    /** Pass-1 candidate rowId used for the second pass; null for manual rows. */
    sourceRowId: text('source_row_id'),
    entries: jsonb('entries').$type<ShiftEntry[]>().notNull(),
    /** Admin only: raw cell text for comparison. */
    sourceCells: jsonb('source_cells').$type<SourceCell[]>().notNull().default([]),
    excluded: boolean('excluded').notNull().default(false),
    extractStatus: text('extract_status').$type<RosterRowExtractStatus>().notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    extractErrorCode: text('extract_error_code').$type<RecognitionErrorCode>(),
    /** Dates still needing review (code missing or unconfirmed). */
    reviewCount: integer('review_count').notNull().default(0),
    updatedAt: buildUpdatedAtColumn(),
  },
  (table) => [
    unique('team_roster_rows_roster_row_key_unique').on(table.rosterId, table.rowKey),
    buildEnumCheck('team_roster_rows_extract_status_check', table.extractStatus, RosterRowExtractStatus),
    buildEnumCheck('team_roster_rows_extract_error_code_check', table.extractErrorCode, RecognitionErrorCode),
  ],
);

export const teamRosterChanges = pgTable(
  'team_roster_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The new revision that introduced the change. */
    rosterId: uuid('roster_id')
      .notNull()
      .references(() => teamRosters.id, { onDelete: 'cascade' }),
    rowKey: text('row_key').notNull(),
    /** YYYY-MM-DD */
    date: text('date').notNull(),
    fromCode: text('from_code'),
    toCode: text('to_code'),
  },
  (table) => [index('team_roster_changes_roster_row_idx').on(table.rosterId, table.rowKey)],
);

export const memberChangeAcks = pgTable(
  'member_change_acks',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(),
    ackedRevision: integer('acked_revision').notNull(),
    updatedAt: buildUpdatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId, table.yearMonth] }),
    buildYearMonthCheck('member_change_acks_year_month_check', table.yearMonth),
  ],
);

/**
 * Team months the member made visible on their own share link (presence = visible). Like personal months,
 * a newly published team month is not visible until the member turns it on.
 */
export const memberSharedTeamMonths = pgTable(
  'member_shared_team_months',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(),
    createdAt: buildCreatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId, table.yearMonth] }),
    index('member_shared_team_months_user_idx').on(table.userId),
    buildYearMonthCheck('member_shared_team_months_year_month_check', table.yearMonth),
  ],
);

/**
 * Shadow OCR runs (Spec §21): numbers only — no names, codes or object keys. `job_id` has no foreign key so
 * the statistics outlive the job and its photo; the cleanup cron deletes rows after 90 days.
 */
export const ocrShadowRuns = pgTable(
  'ocr_shadow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull(),
    createdAt: buildCreatedAtColumn(),
    status: text('status').$type<OcrShadowStatus>().notNull(),
    /** Fixed error classification (`OcrShadowErrorKind`) for `error` rows, never a class name or message. */
    errorName: text('error_name').$type<OcrShadowErrorKind>(),
    dayCount: integer('day_count'),
    agreeCells: integer('agree_cells'),
    disagreeCells: integer('disagree_cells'),
    ocrNullCells: integer('ocr_null_cells'),
    aiNullCells: integer('ai_null_cells'),
    unresolvedCells: integer('unresolved_cells'),
    reviewCells: integer('review_cells'),
    wouldFallback: boolean('would_fallback').notNull(),
    /** Wall time from the run start: includes waiting for the shared workers and starting them. */
    ocrMs: integer('ocr_ms').notNull(),
    coldStart: boolean('cold_start').notNull(),
    /** Process RSS right after the run: a snapshot, not the peak (Spec §21-9). */
    rssMb: integer('rss_mb').notNull(),
  },
  (table) => [
    index('ocr_shadow_runs_created_at_idx').on(table.createdAt),
    buildEnumCheck('ocr_shadow_runs_status_check', table.status, OcrShadowStatus),
    buildEnumCheck('ocr_shadow_runs_error_name_check', table.errorName, OcrShadowErrorKind),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type AuthIdentityRow = typeof authIdentities.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AnonymousSessionRow = typeof anonymousSessions.$inferSelect;
export type RecognitionJobRow = typeof recognitionJobs.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;
export type CalendarRow = typeof calendars.$inferSelect;
export type PublishedMonthRow = typeof publishedMonths.$inferSelect;
export type EntitlementRow = typeof entitlements.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type TeamInviteRow = typeof teamInvites.$inferSelect;
export type TeamRosterRow = typeof teamRosters.$inferSelect;
export type TeamRosterRowRow = typeof teamRosterRows.$inferSelect;
export type TeamRosterChangeRow = typeof teamRosterChanges.$inferSelect;
export type OcrShadowRunRow = typeof ocrShadowRuns.$inferSelect;

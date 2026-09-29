import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { type AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type DraftStatus } from '@/domain/enums/DraftStatus';
import { type EntitlementSource } from '@/domain/enums/EntitlementSource';
import { type PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { type PaymentStatus } from '@/domain/enums/PaymentStatus';
import { type RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { type RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';
import { type TableRecognition } from '@/domain/types/TableRecognition';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Seoul'),
  createdAt: createdAt(),
});

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<AuthProviderType>().notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: text('email'),
    createdAt: createdAt(),
  },
  (table) => [unique('auth_identities_provider_subject_unique').on(table.provider, table.providerSubject)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** sha256(token) hex */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const anonymousSessions = pgTable('anonymous_sessions', {
  /** sha256(token) hex */
  id: text('id').primaryKey(),
  ipHash: text('ip_hash'),
  createdAt: createdAt(),
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
    sourceMime: text('source_mime').notNull(),
    sourceDeletedAt: timestamp('source_deleted_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    /** Temporary: contains other people's names. Cleared on expiry. */
    tableResult: jsonb('table_result').$type<TableRecognition>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('recognition_jobs_user_id_idx').on(table.userId),
    index('recognition_jobs_anonymous_session_id_idx').on(table.anonymousSessionId),
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
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('drafts_user_id_idx').on(table.userId),
    uniqueIndex('drafts_job_row_month_unique')
      .on(table.recognitionJobId, table.personRowId, table.yearMonth)
      .where(sql`${table.recognitionJobId} is not null`),
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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
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
    updatedAt: updatedAt(),
  },
  (table) => [unique('published_months_calendar_month_unique').on(table.calendarId, table.yearMonth)],
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
    createdAt: createdAt(),
  },
  (table) => [unique('entitlements_user_month_unique').on(table.userId, table.yearMonth)],
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [index('payments_user_month_idx').on(table.userId, table.yearMonth)],
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
  (table) => [unique('payment_events_provider_event_key_unique').on(table.provider, table.eventKey)],
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

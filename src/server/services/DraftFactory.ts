import { MAX_DISPLAY_NAME_LENGTH, MS_PER_DAY } from '@/domain/DomainLimits';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';
import { getAppConfig } from '@/server/config/AppConfig';
import { type drafts } from '@/server/db/Schema';

export type DraftInsert = typeof drafts.$inferInsert;

export type NewDraftInput = {
  userId: string;
  yearMonth: string;
  displayName: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
  sourceCells: SourceCell[];
  /** Recognition job the draft came from; null for edit drafts of a published month. */
  recognitionJobId: string | null;
  /** Selected row; null for manual-name and edit drafts. */
  personRowId: string | null;
  /** Published revision an edit draft was copied from; null otherwise. */
  basePublishedRevision: number | null;
};

/** Drafts live DRAFT_TTL_DAYS from creation (independent of the source photo TTL). */
export const buildDraftExpiry = (now: Date): Date =>
  new Date(now.getTime() + getAppConfig().draftTtlDays * MS_PER_DAY);

/** Single place that shapes a new editing draft row. */
export const buildDraftInsert = (input: NewDraftInput, now = new Date()): DraftInsert => ({
  userId: input.userId,
  recognitionJobId: input.recognitionJobId,
  personRowId: input.personRowId,
  basePublishedRevision: input.basePublishedRevision,
  yearMonth: input.yearMonth,
  displayName: input.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH),
  definitions: input.definitions,
  entries: input.entries,
  sourceCells: input.sourceCells,
  status: DraftStatus.EDITING,
  expiresAt: buildDraftExpiry(now),
});

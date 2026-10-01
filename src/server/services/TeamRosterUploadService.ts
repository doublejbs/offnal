import 'server-only';

import { and, eq, max } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { assignRowKeys } from '@/domain/TeamRowKey';
import { type CreateTeamRosterResponse } from '@/domain/types/api/CreateTeamRosterResponse';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { currentYearMonthInSeoul, isValidYearMonth, nextYearMonth } from '@/domain/YearMonth';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
import {
  type RecognitionJobRow,
  recognitionJobs,
  type TeamRosterRow,
  teamRosterRows,
  teamRosters,
} from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { enforceUploadLimits } from '@/server/services/RateLimitService';
import { createRecognitionJob, runRecognitionForJob } from '@/server/services/RecognitionProcessService';
import { assertTeamPlanActive, requireTeamAdmin } from '@/server/services/TeamAccess';
import { MAX_ROSTER_ROWS } from '@/server/services/TeamRequestSchemas';
import { countReviewDates } from '@/server/services/TeamRosterRows';
import { validateUpload } from '@/server/services/UploadValidator';

export const AUTHORITY_REQUIRED_MESSAGE = '“이 근무표를 팀에 공유할 권한이 있어요”에 동의해 주세요.';

export type RosterUploadInput = {
  bytes: Buffer;
  /** Admin-chosen month (form field, unvalidated); null = use the recognized month. */
  yearMonth: string | null;
  authorityConfirmed: boolean;
};

/** Latest published revision number of a team month (0 = never published). */
export const findLatestRevision = async (
  db: DbExecutor,
  teamId: string,
  yearMonth: string,
): Promise<number> => {
  const [row] = await db
    .select({ value: max(teamRosters.revision) })
    .from(teamRosters)
    .where(and(eq(teamRosters.teamId, teamId), eq(teamRosters.yearMonth, yearMonth)));

  return row?.value ?? 0;
};

/**
 * POST /api/teams/:id/rosters (ADMIN): stores the photo privately under a recognition job owned by the
 * uploading admin (same source TTL and limits as personal uploads) and creates the DRAFT roster with the
 * admin's authority consent time. Recognition itself runs in extract-next.
 */
export const uploadRoster = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  input: RosterUploadInput,
): Promise<CreateTeamRosterResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await assertTeamPlanActive(db, team.id);

  if (!input.authorityConfirmed) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, {
      message: AUTHORITY_REQUIRED_MESSAGE,
      details: { fields: ['authorityConfirmed'] },
    });
  }

  if (input.yearMonth !== null && !isValidYearMonth(input.yearMonth)) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { details: { fields: ['yearMonth'] } });
  }

  const config = getAppConfig();

  // Same limits and validation as personal uploads; attempts count before decoding.
  await enforceUploadLimits(db, {
    userId: loggedIn.user.id,
    anonymousSessionId: null,
    ipHash: loggedIn.ipHash,
  });

  const upload = await validateUpload(input.bytes, {
    maxBytes: config.uploadMaxBytes,
    maxPixels: config.uploadMaxPixels,
  });
  const job = await createRecognitionJob(db, {
    userId: loggedIn.user.id,
    anonymousSessionId: null,
    ipHash: loggedIn.ipHash,
    bytes: input.bytes,
    mime: upload.mime,
  });
  const [roster] = await db
    .insert(teamRosters)
    .values({
      teamId: team.id,
      yearMonth: input.yearMonth,
      status: TeamRosterStatus.DRAFT,
      baseRevision: input.yearMonth ? await findLatestRevision(db, team.id, input.yearMonth) : 0,
      sourceJobId: job.id,
      authorityConfirmedAt: new Date(),
      createdBy: loggedIn.user.id,
    })
    .returning({ id: teamRosters.id });

  if (!roster) {
    throw new Error('Roster insert returned no row');
  }

  return { rosterId: roster.id };
};

export const findRosterJob = async (
  db: DbExecutor,
  roster: TeamRosterRow,
): Promise<RecognitionJobRow | null> => {
  if (!roster.sourceJobId) {
    return null;
  }

  const [job] = await db
    .select()
    .from(recognitionJobs)
    .where(eq(recognitionJobs.id, roster.sourceJobId))
    .limit(1);

  return job ?? null;
};

/** Rows from pass-1 candidates (once): row_key = normalized name + same-name ordinal, every date empty. */
const createRowsFromTable = async (db: Db, rosterId: string, table: TableRecognition): Promise<void> => {
  await db.transaction(async (tx) => {
    const [roster] = await tx.select().from(teamRosters).where(eq(teamRosters.id, rosterId)).for('update');

    if (!roster || roster.rowsCreatedAt || roster.status !== TeamRosterStatus.DRAFT) {
      return;
    }

    const yearMonth =
      roster.yearMonth ?? table.yearMonth ?? nextYearMonth(currentYearMonthInSeoul(new Date()));
    const candidates = table.candidates.slice(0, MAX_ROSTER_ROWS);
    const keys = assignRowKeys(candidates.map((candidate) => candidate.name));
    const empty = normalizeExtraction(
      { yearMonth, rowId: '', displayName: '', definitions: table.definitions, cells: [] },
      yearMonth,
    );

    if (candidates.length > 0) {
      await tx.insert(teamRosterRows).values(
        candidates.map((candidate, index) => ({
          rosterId,
          rowKey: keys[index]?.rowKey ?? `${candidate.rowId}#1`,
          displayName: candidate.name,
          sameNameOrdinal: keys[index]?.sameNameOrdinal ?? 1,
          position: index,
          sourceRowId: candidate.rowId,
          entries: empty.entries,
          sourceCells: empty.sourceCells,
          extractStatus: RosterRowExtractStatus.PENDING,
          reviewCount: countReviewDates(empty.entries),
        })),
      );
    }

    await tx
      .update(teamRosters)
      .set({
        yearMonth,
        definitions: empty.definitions,
        rowsCreatedAt: new Date(),
        baseRevision: roster.yearMonth
          ? roster.baseRevision
          : await findLatestRevision(tx, roster.teamId, yearMonth),
      })
      .where(eq(teamRosters.id, rosterId));
  });
};

/**
 * First pass for an upload draft (extract-next): runs/retries recognition under the job lease, then creates
 * the rows. Concurrent callers are safe (job lease + roster row lock). Returns the job as last seen.
 */
export const ensureRosterRows = async (db: Db, roster: TeamRosterRow): Promise<RecognitionJobRow | null> => {
  if (roster.rowsCreatedAt) {
    return findRosterJob(db, roster);
  }

  let job = await findRosterJob(db, roster);

  if (job && job.status !== RecognitionStatus.RECOGNIZED) {
    job = (await runRecognitionForJob(db, job)) ?? (await findRosterJob(db, roster));
  }

  if (job?.status === RecognitionStatus.RECOGNIZED && job.tableResult) {
    await createRowsFromTable(db, roster.id, job.tableResult);
  }

  return job;
};

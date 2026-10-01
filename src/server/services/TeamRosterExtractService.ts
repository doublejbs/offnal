import 'server-only';

import { eq } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type ExtractNextRequest } from '@/domain/types/api/ExtractNextRequest';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';
import { type Db } from '@/server/db/Database';
import { type RecognitionJobRow, type TeamRosterRow, teamRosters } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import {
  extractRowWithPreparedImage,
  type PreparedJobImage,
  type PreparedJobImageResult,
  RowExtractionError,
  tryPrepareJobImage,
} from '@/server/services/RecognitionPersonExtractor';
import { assertTeamPlanActive, requireTeamAdmin } from '@/server/services/TeamAccess';
import { buildRosterProgress, toFailedRows } from '@/server/services/TeamRosterProgressBuilder';
import { requireTeamRoster } from '@/server/services/TeamRosterQueries';
import {
  claimRows,
  type ClaimedRow,
  failExhaustedLeases,
  renewLeases,
  requeueRetryableRows,
  type RowOutcome,
  storeOutcome,
} from '@/server/services/TeamRosterRowLease';
import { listRosterRows } from '@/server/services/TeamRosterRows';
import { ensureRosterRows } from '@/server/services/TeamRosterUploadService';

const readRow = async (image: PreparedJobImage, row: ClaimedRow, yearMonth: string): Promise<RowOutcome> => {
  if (!row.sourceRowId) {
    return { ok: false, errorCode: RecognitionErrorCode.SOURCE_MISSING };
  }

  try {
    return {
      ok: true,
      schedule: await extractRowWithPreparedImage(image, row.sourceRowId, row.displayName, yearMonth),
    };
  } catch (error: unknown) {
    if (error instanceof RowExtractionError) {
      return { ok: false, errorCode: error.errorCode };
    }

    throw error;
  }
};

const prepareImage = async (job: RecognitionJobRow | null): Promise<PreparedJobImageResult> =>
  job?.tableResult
    ? tryPrepareJobImage(job, job.tableResult)
    : { ok: false, errorCode: RecognitionErrorCode.SOURCE_MISSING };

/** An unexpected error fails only that row; the batch's other results are kept. */
const toOutcome = (result: PromiseSettledResult<RowOutcome>): RowOutcome => {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  console.warn('[team] row extraction crashed', {
    name: result.reason instanceof Error ? result.reason.name : typeof result.reason,
  });

  return { ok: false, errorCode: RecognitionErrorCode.PROVIDER_ERROR };
};

/**
 * Claims up to 4 rows and reads them in parallel from one prepared image. Returns the rows whose results
 * were actually stored (late results discarded by the lease fence are not "processed").
 */
const extractBatch = async (
  db: Db,
  roster: TeamRosterRow,
  yearMonth: string,
  job: RecognitionJobRow | null,
  retryFailed: boolean,
): Promise<string[]> => {
  const now = new Date();

  if (retryFailed) {
    await requeueRetryableRows(db, roster.id, now);
  }

  await failExhaustedLeases(db, roster.id, now);

  const claimed = await claimRows(db, roster.id, now);

  if (claimed.length === 0) {
    return [];
  }

  const prepared = await prepareImage(job);

  await renewLeases(db, claimed);

  const settled = await Promise.allSettled(
    claimed.map(async (row): Promise<RowOutcome> =>
      prepared.ok ? readRow(prepared.image, row, yearMonth) : prepared,
    ),
  );
  const stored: string[] = [];

  for (const [index, row] of claimed.entries()) {
    const result = settled[index];

    if (result && (await storeOutcome(db, roster.id, row, toOutcome(result), yearMonth))) {
      stored.push(row.id);
    }
  }

  return stored;
};

/**
 * POST /api/teams/:id/rosters/:rid/extract-next (ADMIN, DRAFT): first pass if needed, then up to 4 rows in
 * parallel. State lives in the rows, so a closed browser resumes where it stopped.
 */
export const extractNextRows = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  rosterId: string,
  body: ExtractNextRequest,
): Promise<ExtractNextResponse> => {
  const { team } = await requireTeamAdmin(db, context, teamId);
  const roster = await requireTeamRoster(db, team.id, rosterId);

  if (roster.status !== TeamRosterStatus.DRAFT) {
    throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE);
  }

  await assertTeamPlanActive(db, team.id);

  const job = await ensureRosterRows(db, roster);
  const [current] = await db.select().from(teamRosters).where(eq(teamRosters.id, roster.id));
  const ready = current?.rowsCreatedAt && current.yearMonth ? current.yearMonth : null;
  const processedRowIds = ready ? await extractBatch(db, roster, ready, job, body.retryFailed === true) : [];
  const [latest] = await db.select().from(teamRosters).where(eq(teamRosters.id, roster.id));
  const rows = await listRosterRows(db, roster.id);
  const now = new Date();

  return {
    progress: buildRosterProgress(latest ?? roster, rows, job, now),
    processedRowIds,
    failedRows: toFailedRows(
      rows.filter((row) => processedRowIds.includes(row.id)),
      now,
    ),
  };
};

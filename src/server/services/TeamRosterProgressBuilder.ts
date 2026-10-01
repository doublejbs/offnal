import 'server-only';

import { MAX_ROW_ATTEMPTS } from '@/domain/DomainLimits';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { type TeamRosterFailedRow } from '@/domain/types/api/TeamRosterFailedRow';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';
import { type RecognitionJobRow, type TeamRosterRow, type TeamRosterRowRow } from '@/server/db/Schema';
import { isJobExpired, isJobRetryable, RETRYABLE_ERROR_CODES } from '@/server/services/RecognitionOwnership';

/**
 * Effective state of a row: a PROCESSING row whose lease ran out is claimable again (PENDING) or, with no
 * attempts left, FAILED — even before the next extract-next call rewrites it.
 */
export const classifyRow = (row: TeamRosterRowRow, now: Date): RosterRowExtractStatus => {
  if (row.extractStatus !== RosterRowExtractStatus.PROCESSING) {
    return row.extractStatus;
  }

  if (row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now.getTime()) {
    return RosterRowExtractStatus.PROCESSING;
  }

  return row.attemptCount < MAX_ROW_ATTEMPTS ? RosterRowExtractStatus.PENDING : RosterRowExtractStatus.FAILED;
};

/** Waiting for or being read by extract-next: not editable, blocks publish and month changes. */
export const isRowBusy = (row: TeamRosterRowRow, now: Date): boolean => {
  const status = classifyRow(row, now);

  return status === RosterRowExtractStatus.PENDING || status === RosterRowExtractStatus.PROCESSING;
};

/** The single rule for "다시 시도" (counts, failed-row lists and the actual requeue all use it). */
export const isRowRetryable = (row: TeamRosterRowRow, now: Date): boolean =>
  !row.excluded &&
  classifyRow(row, now) === RosterRowExtractStatus.FAILED &&
  row.attemptCount < MAX_ROW_ATTEMPTS &&
  (row.extractErrorCode === null || RETRYABLE_ERROR_CODES.includes(row.extractErrorCode));

export const toFailedRows = (rows: TeamRosterRowRow[], now: Date): TeamRosterFailedRow[] =>
  rows
    .filter((row) => !row.excluded && classifyRow(row, now) === RosterRowExtractStatus.FAILED)
    .map((row) => ({
      rowId: row.id,
      displayName: row.displayName,
      attemptCount: row.attemptCount,
      errorCode: row.extractErrorCode,
      retryable: isRowRetryable(row, now),
    }));

const countBy = (rows: TeamRosterRowRow[], status: RosterRowExtractStatus, now: Date): number =>
  rows.filter((row) => !row.excluded && classifyRow(row, now) === status).length;

const buildFirstPassProgress = (job: RecognitionJobRow | null, now: Date): TeamRosterProgress => {
  const base: TeamRosterProgress = {
    phase: TeamRosterPhase.RECOGNIZING,
    total: 0,
    done: 0,
    manual: 0,
    failed: 0,
    pending: 0,
    processing: 0,
    excluded: 0,
    recognitionErrorCode: null,
    retryable: false,
    retryableRowCount: 0,
  };

  if (!job || isJobExpired(job, now)) {
    return {
      ...base,
      phase: TeamRosterPhase.RECOGNITION_FAILED,
      recognitionErrorCode: RecognitionErrorCode.SOURCE_MISSING,
    };
  }

  if (job.status === RecognitionStatus.FAILED) {
    return {
      ...base,
      phase: TeamRosterPhase.RECOGNITION_FAILED,
      recognitionErrorCode: job.errorCode,
      retryable: isJobRetryable(job),
    };
  }

  return base;
};

/** Real counts only (no estimated progress). Rows exist once the first pass created them. */
export const buildRosterProgress = (
  roster: TeamRosterRow,
  rows: TeamRosterRowRow[],
  job: RecognitionJobRow | null,
  now = new Date(),
): TeamRosterProgress => {
  if (!roster.rowsCreatedAt) {
    return buildFirstPassProgress(job, now);
  }

  const pending = countBy(rows, RosterRowExtractStatus.PENDING, now);
  const processing = countBy(rows, RosterRowExtractStatus.PROCESSING, now);

  return {
    phase: pending + processing > 0 ? TeamRosterPhase.EXTRACTING : TeamRosterPhase.READY,
    total: rows.filter((row) => !row.excluded).length,
    done: countBy(rows, RosterRowExtractStatus.DONE, now),
    manual: countBy(rows, RosterRowExtractStatus.MANUAL, now),
    failed: countBy(rows, RosterRowExtractStatus.FAILED, now),
    pending,
    processing,
    excluded: rows.filter((row) => row.excluded).length,
    recognitionErrorCode: null,
    retryable: false,
    retryableRowCount: rows.filter((row) => !row.excluded && isRowRetryable(row, now)).length,
  };
};

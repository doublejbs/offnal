'use client';

import { useId } from 'react';

import { recognitionErrorMessage } from '@/client/DisplayText';
import { type TeamRosterFailedRow } from '@/domain/types/api/TeamRosterFailedRow';

type RosterFailedRowsViewProps = {
  failedRows: TeamRosterFailedRow[];
  isBusy: boolean;
  /** Also disabled without the busy label (e.g. unsaved edits first). */
  disabled?: boolean;
  onRetry: () => void;
};

/** People whose row could not be read: retry (max 3 attempts) or fill in by hand in the review table. */
const RosterFailedRowsView = ({
  failedRows,
  isBusy,
  disabled = false,
  onRetry,
}: RosterFailedRowsViewProps) => {
  const titleId = useId();
  const retryable = failedRows.filter((row) => row.retryable);

  if (failedRows.length === 0) {
    return null;
  }

  return (
    <section className="warning" aria-labelledby={titleId}>
      <strong id={titleId}>읽지 못한 사람 {failedRows.length}명</strong>
      <ul>
        {failedRows.map((row) => (
          <li key={row.rowId}>
            {row.displayName} · {recognitionErrorMessage(row.errorCode)}
            {!row.retryable && ' (직접 입력해 주세요)'}
          </li>
        ))}
      </ul>
      {retryable.length > 0 && (
        <button type="button" className="secondary mt-10" disabled={isBusy || disabled} onClick={onRetry}>
          {isBusy ? '다시 읽는 중…' : `${retryable.length}명 다시 시도`}
        </button>
      )}
    </section>
  );
};

export default RosterFailedRowsView;

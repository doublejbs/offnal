'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';

import { recognitionErrorMessage } from '@/client/DisplayText';
import { countReadRows, formatRosterProgress } from '@/client/TeamDisplayText';
import BackLink from '@/components/BackLink';
import RosterFailedRowsView from '@/components/roster/RosterFailedRowsView';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { type TeamRosterFailedRow } from '@/domain/types/api/TeamRosterFailedRow';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';

type RosterProgressViewProps = {
  teamHref: string;
  progress: TeamRosterProgress;
  failedRows: TeamRosterFailedRow[];
  isRunning: boolean;
  error: string | null;
  onStart: (retryFailed: boolean) => void;
};

/**
 * Phase (a): real counts only ("12/18명 읽는 중"). Leaving is safe — the server keeps every row, and opening the
 * roster again continues. A first-pass failure explains the cause and offers retry or another photo.
 */
const RosterProgressView = ({
  teamHref,
  progress,
  failedRows,
  isRunning,
  error,
  onStart,
}: RosterProgressViewProps) => {
  const isFailed = progress.phase === TeamRosterPhase.RECOGNITION_FAILED;
  const read = countReadRows(progress);

  return (
    <>
      <BackLink href={teamHref} label="팀으로" />
      <div className="label">1 / 2 · 팀원 근무 읽기</div>
      <h1>{isFailed ? '근무표를 읽지 못했어요' : '팀원 근무를 읽고 있어요'}</h1>
      {isFailed ? (
        <div className="warning" role="alert">
          {recognitionErrorMessage(progress.recognitionErrorCode)}
        </div>
      ) : (
        <div className="progress-card" role="status" aria-live="polite">
          <div className="progress-text">
            {isRunning && <LoaderCircle size={18} aria-hidden="true" className="spin" />}
            <strong>{formatRosterProgress(progress)}</strong>
          </div>
          {progress.total > 0 && (
            <progress className="roster-progress" max={progress.total} value={read} aria-hidden="true" />
          )}
          <div className="tiny">
            한 사람씩 사진에서 근무를 읽어요. 이 화면을 나가도 다음에 열면 이어서 읽어요.
          </div>
        </div>
      )}
      <RosterFailedRowsView failedRows={failedRows} isBusy={isRunning} onRetry={() => onStart(true)} />
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}
      <div className="stack mt-16">
        {!isRunning && !isFailed && (
          <button type="button" className="primary" onClick={() => onStart(false)}>
            이어서 읽기
          </button>
        )}
        {isFailed && progress.retryable && (
          <button type="button" className="primary" disabled={isRunning} onClick={() => onStart(false)}>
            {isRunning ? '다시 읽는 중…' : '다시 시도'}
          </button>
        )}
        <Link href={teamHref} className="secondary">
          {isFailed ? '다른 사진 올리기' : '나중에 이어서 하기'}
        </Link>
      </div>
    </>
  );
};

export default RosterProgressView;

'use client';

import { LoaderCircle } from 'lucide-react';
import { useId } from 'react';

import { formatHours } from '@/client/LandingCopy';
import { usePublicConfig } from '@/components/ConfigProvider';
import { useRosterUploadState } from '@/components/team/UseRosterUploadState';

type RosterUploadFormProps = {
  teamId: string;
};

/** New roster upload. The consent checkbox is required (stored as `authority_confirmed_at`). */
const RosterUploadForm = ({ teamId }: RosterUploadFormProps) => {
  const { uploadMaxBytes, sourceTtlHours } = usePublicConfig();
  const state = useRosterUploadState(teamId, uploadMaxBytes);
  const fileId = useId();
  const statusId = useId();

  return (
    <form onSubmit={state.handleSubmit} className="stack" aria-describedby={statusId}>
      <div>
        <input
          id={fileId}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={state.isUploading}
          onChange={state.handleFileChange}
        />
        <label htmlFor={fileId} className="secondary" aria-disabled={state.isUploading}>
          {state.file ? '다른 사진 고르기' : '근무표 사진 고르기'}
        </label>
        <div className="tiny mt-8">
          {state.file ? `고른 사진: ${state.file.name}` : '표 전체와 날짜, 이름 열이 선명하게 보이는 사진'}
        </div>
      </div>
      <label className="inline-field">
        대상 월 (선택)
        <input
          type="month"
          value={state.yearMonth}
          disabled={state.isUploading}
          onChange={(event) => state.setYearMonth(event.target.value)}
        />
      </label>
      <div className="tiny">비워 두면 사진에서 연·월을 읽어요.</div>
      <label className="check notice m-0">
        <input
          type="checkbox"
          checked={state.isAuthorityConfirmed}
          disabled={state.isUploading}
          onChange={(event) => state.setIsAuthorityConfirmed(event.target.checked)}
        />
        <span>
          <strong>이 근무표를 팀에 공유할 권한이 있어요</strong>
          <span className="tiny block-text">
            근무표의 이름과 근무는 팀 근무표로 저장되고 승인된 팀원에게 보여요. 팀이나 그 달을 삭제하면 함께
            지워져요.
          </span>
        </span>
      </label>
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      <button type="submit" className="primary" disabled={!state.canSubmit}>
        {state.isUploading && <LoaderCircle size={18} className="spin" aria-hidden="true" />}
        {state.isUploading ? '올리는 중…' : '올리고 팀원 근무 읽기'}
      </button>
      <div id={statusId} className="status-line" role="status" aria-live="polite">
        {state.statusText}
      </div>
      <div className="hint m-0">
        사진은 AI로 분석해요. 배포하면 원본을 삭제하고, 배포하지 않아도 {formatHours(sourceTtlHours)}이 지나면
        열 수 없어요.
      </div>
    </form>
  );
};

export default RosterUploadForm;

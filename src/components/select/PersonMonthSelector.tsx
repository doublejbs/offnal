'use client';

import Link from 'next/link';

import { getRecognitionSourceUrl } from '@/client/ApiClient';
import AuthRequired from '@/components/AuthRequired';
import BackLink from '@/components/BackLink';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import CandidateList from '@/components/select/CandidateList';
import { usePersonMonthState } from '@/components/select/UsePersonMonthState';
import SourcePreview from '@/components/SourcePreview';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

type PersonMonthSelectorProps = {
  recognitionId: string;
};

const PersonMonthSelector = ({ recognitionId }: PersonMonthSelectorProps) => {
  const state = usePersonMonthState(recognitionId);
  const { data } = state.candidates;
  const loadState = state.candidates.state;

  if (loadState === ScreenLoadState.LOADING || state.isNotReady) {
    return <LoadingState text="인식한 이름을 불러오는 중이에요…" />;
  }

  if (loadState === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`/recognitions/${recognitionId}`} />;
  }

  if (loadState !== ScreenLoadState.READY || !data) {
    return (
      <RecoverableError
        title={loadState === ScreenLoadState.EXPIRED ? '보관 기간이 지났어요' : '근무표를 불러오지 못했어요'}
        message={state.candidates.errorMessage ?? '사진을 다시 올려 주세요.'}
        onRetry={loadState === ScreenLoadState.ERROR ? state.candidates.reload : undefined}
        alternativeHref="/upload"
        alternativeLabel="사진 다시 올리기"
      />
    );
  }

  return (
    <form onSubmit={state.handleSubmit} noValidate>
      <BackLink href="/upload" label="다른 사진 올리기" />
      <div className="label">1 / 2 · 내 근무 찾기</div>
      <h1>어느 분의 근무표인가요?</h1>
      <p>이름과 대상 월을 확인해 주세요.</p>
      {state.isSourceGone && (
        <div className="warning" role="alert">
          원본 사진이 삭제되었거나 보관 기간이 지나 내 근무를 가져올 수 없어요. 사진을 다시 올려 주세요.
          <Link href="/upload" className="primary mt-10">
            사진 다시 올리기
          </Link>
        </div>
      )}
      <label className="field">
        근무표 대상 월
        <input
          type="month"
          value={state.yearMonth}
          disabled={state.isSourceGone}
          onChange={(event) => state.setYearMonth(event.target.value)}
          required
        />
      </label>
      {data.yearMonthGuess === null && (
        <div className="warning">사진에서 연·월을 찾지 못했어요. 대상 월을 직접 선택해 주세요.</div>
      )}
      {!state.isManual && (
        <CandidateList
          candidates={data.candidates}
          selectedRowId={state.selectedRowId}
          disabled={state.isSourceGone}
          onSelect={state.setSelectedRowId}
        />
      )}
      {state.isManual && (
        <div>
          <label className="field">
            내 이름 (직접 입력)
            <input
              value={state.manualName}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              onChange={(event) => state.setManualName(event.target.value)}
              autoComplete="name"
            />
          </label>
          <div className="notice">
            직접 입력하면 모든 날짜가 비어 있는 상태로 시작해요. 원본 사진을 확대해 보면서 근무를 채워 주세요.
          </div>
          <SourcePreview src={getRecognitionSourceUrl(recognitionId)} />
        </div>
      )}
      {state.submitError && (
        <div className="warning" role="alert">
          {state.submitError}
        </div>
      )}
      {!state.isSourceGone && (
        <>
          <div className="pt-20">
            <button type="submit" className="primary" disabled={!state.canSubmit}>
              {state.isSubmitting ? '내 근무를 가져오는 중…' : '내 근무 확인하기'}
            </button>
          </div>
          <div className="center">
            <button type="button" className="textbutton" onClick={state.handleToggleManual}>
              {state.isManual ? '인식된 이름에서 고르기' : '이름이 없어요'}
            </button>
          </div>
        </>
      )}
    </form>
  );
};

export default PersonMonthSelector;

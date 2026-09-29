'use client';

import AuthRequired from '@/components/AuthRequired';
import BackLink from '@/components/BackLink';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import { usePersonMonthState } from '@/components/select/UsePersonMonthState';
import SourcePreview from '@/components/SourcePreview';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

type PersonMonthSelectorProps = {
  recognitionId: string;
};

const PersonMonthSelector = ({ recognitionId }: PersonMonthSelectorProps) => {
  const state = usePersonMonthState(recognitionId);
  const { data } = state;

  if (state.loadState === ScreenLoadState.LOADING) {
    return <LoadingState text="인식한 이름을 불러오는 중이에요…" />;
  }

  if (state.loadState === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`/recognitions/${recognitionId}`} />;
  }

  if (state.loadState !== ScreenLoadState.READY || !data) {
    return (
      <RecoverableError
        title={
          state.loadState === ScreenLoadState.EXPIRED ? '보관 기간이 지났어요' : '근무표를 불러오지 못했어요'
        }
        message={state.loadError ?? '사진을 다시 올려 주세요.'}
        alternativeHref="/"
        alternativeLabel="사진 다시 올리기"
      />
    );
  }

  return (
    <form onSubmit={state.handleSubmit} noValidate>
      <BackLink href="/" label="다른 사진 올리기" />
      <div className="label">1 / 2 · 내 근무 찾기</div>
      <h1>어느 분의 근무표인가요?</h1>
      <p>이름과 대상 월을 확인해 주세요.</p>
      <label className="field">
        근무표 대상 월
        <input
          type="month"
          value={state.yearMonth}
          onChange={(event) => state.setYearMonth(event.target.value)}
          required
        />
      </label>
      {data.yearMonthGuess === null && (
        <div className="warning">사진에서 연·월을 찾지 못했어요. 대상 월을 직접 선택해 주세요.</div>
      )}
      {!state.isManual && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <legend className="tiny" style={{ marginBottom: 12 }}>
            인식된 이름
          </legend>
          {data.candidates.length === 0 && (
            <div className="warning">인식된 이름이 없어요. 이름을 직접 입력해 주세요.</div>
          )}
          {data.candidates.map((candidate) => (
            <label key={candidate.rowId} className="person">
              <span>{candidate.name}</span>
              <input
                type="radio"
                name="person"
                value={candidate.rowId}
                checked={state.selectedRowId === candidate.rowId}
                onChange={() => state.setSelectedRowId(candidate.rowId)}
              />
            </label>
          ))}
        </fieldset>
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
          {data.sourceAvailable ? (
            <SourcePreview recognitionId={recognitionId} />
          ) : (
            <div className="warning">원본 사진 보관 기간이 지나 원본을 볼 수 없어요.</div>
          )}
        </div>
      )}
      {state.submitError && (
        <div className="warning" role="alert">
          {state.submitError}
        </div>
      )}
      <div style={{ paddingTop: 20 }}>
        <button type="submit" className="primary" disabled={!state.canSubmit}>
          {state.isSubmitting ? '내 근무를 가져오는 중…' : '내 근무 확인하기'}
        </button>
      </div>
      <div className="center">
        <button type="button" className="textbutton" onClick={state.handleToggleManual}>
          {state.isManual ? '인식된 이름에서 고르기' : '이름이 없어요'}
        </button>
      </div>
    </form>
  );
};

export default PersonMonthSelector;

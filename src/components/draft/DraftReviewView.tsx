'use client';

import Link from 'next/link';

import AuthRequired from '@/components/AuthRequired';
import DraftEditorView from '@/components/draft/DraftEditorView';
import { useDraftReviewState } from '@/components/draft/UseDraftReviewState';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

type DraftReviewViewProps = {
  draftId: string;
};

/** Load/guard states of the draft screen; the editor itself is DraftEditorView. */
const DraftReviewView = ({ draftId }: DraftReviewViewProps) => {
  const state = useDraftReviewState(draftId);
  const { server, local } = state;

  if (state.loadState === ScreenLoadState.LOADING) {
    return <LoadingState text="내 근무를 불러오는 중이에요…" />;
  }

  if (state.loadState === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`/drafts/${draftId}`} />;
  }

  if (state.loadState !== ScreenLoadState.READY || !server || !local) {
    return (
      <RecoverableError
        title={
          state.loadState === ScreenLoadState.EXPIRED
            ? '초안 보관 기간이 지났어요'
            : '초안을 불러오지 못했어요'
        }
        message={state.loadError ?? '다시 시도해 주세요.'}
        onRetry={state.loadState === ScreenLoadState.ERROR ? state.handleReload : undefined}
        alternativeHref="/upload"
        alternativeLabel="근무표 새로 올리기"
      />
    );
  }

  if (!state.isEditable) {
    return (
      <EmptyState
        label="이미 저장했어요"
        title="이 근무표는 더 이상 수정할 수 없어요"
        description="이미 저장했거나 취소한 초안이에요. 내 달력에서 확인하고, 필요하면 근무 수정을 눌러 주세요."
      >
        <Link href={`/calendar/${server.draft.yearMonth}`} className="primary">
          내 달력 보기
        </Link>
      </EmptyState>
    );
  }

  return <DraftEditorView state={state} server={server} local={local} />;
};

export default DraftReviewView;

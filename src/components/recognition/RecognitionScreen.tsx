'use client';

import { recognitionErrorMessage } from '@/client/DisplayText';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import BlurredPreviewGate from '@/components/recognition/BlurredPreviewGate';
import RecognitionProgress from '@/components/recognition/RecognitionProgress';
import { useRecognitionState } from '@/components/recognition/UseRecognitionState';
import RecoverableError from '@/components/RecoverableError';
import { RecognitionViewMode } from '@/domain/enums/RecognitionViewMode';

type RecognitionScreenProps = {
  id: string;
  loginFailed: boolean;
};

const RecognitionScreen = ({ id, loginFailed }: RecognitionScreenProps) => {
  const { mode, status, isDelayed, claimError, handleRetry } = useRecognitionState(id);

  if (claimError) {
    return (
      <RecoverableError
        title="계정에 연결하지 못했어요"
        message={claimError}
        onRetry={handleRetry}
        alternativeHref="/"
        alternativeLabel="다른 사진 올리기"
      />
    );
  }

  if (mode === RecognitionViewMode.GATE) {
    return <BlurredPreviewGate recognitionId={id} loginFailed={loginFailed} />;
  }

  if (mode === RecognitionViewMode.FAILED) {
    return (
      <RecoverableError
        title="근무표를 읽지 못했어요"
        message={recognitionErrorMessage(status?.errorCode ?? null)}
        onRetry={status?.retryable ? handleRetry : undefined}
        alternativeHref="/"
        alternativeLabel="다른 사진 올리기"
      />
    );
  }

  if (mode === RecognitionViewMode.EXPIRED) {
    return (
      <RecoverableError
        title="보관 기간이 지났어요"
        message="올린 사진의 임시 보관 기간이 지나 이어서 진행할 수 없어요. 사진을 다시 올려 주세요."
        alternativeHref="/"
        alternativeLabel="사진 다시 올리기"
      />
    );
  }

  if (mode === RecognitionViewMode.NOT_FOUND) {
    return (
      <RecoverableError
        title="작업을 찾을 수 없어요"
        message="다른 기기나 브라우저에서 올린 사진이거나 이미 정리된 작업이에요. 사진을 다시 올려 주세요."
        alternativeHref="/"
        alternativeLabel="사진 다시 올리기"
      />
    );
  }

  if (mode === RecognitionViewMode.CLAIMING) {
    return (
      <EmptyState label="근무표 인식 완료" title="내 근무를 찾으러 가요">
        <LoadingState text="이름 선택 화면으로 이동하는 중이에요…" />
      </EmptyState>
    );
  }

  if (mode === RecognitionViewMode.LOADING) {
    return <LoadingState />;
  }

  return <RecognitionProgress status={status?.status ?? null} isDelayed={isDelayed} />;
};

export default RecognitionScreen;

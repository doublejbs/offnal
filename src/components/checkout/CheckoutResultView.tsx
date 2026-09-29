'use client';

import Link from 'next/link';

import {
  type CheckoutResultQuery,
  useCheckoutResultState,
} from '@/components/checkout/UseCheckoutResultState';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import { CheckoutResultStage } from '@/domain/enums/CheckoutResultStage';

type CheckoutResultViewProps = {
  query: CheckoutResultQuery;
};

const buildCheckoutHref = (yearMonth: string, draftId: string | null): string =>
  `/checkout/${yearMonth}${draftId ? `?draftId=${encodeURIComponent(draftId)}` : ''}`;

const CheckoutResultView = ({ query }: CheckoutResultViewProps) => {
  const state = useCheckoutResultState(query);
  const draftHref = state.draftId ? `/drafts/${state.draftId}` : '/calendar';

  if (state.stage === CheckoutResultStage.CONFIRMING || state.stage === CheckoutResultStage.PUBLISHING) {
    return (
      <EmptyState
        label="결제 확인"
        title={
          state.stage === CheckoutResultStage.CONFIRMING ? '결제를 확인하고 있어요' : '달력에 저장하고 있어요'
        }
      >
        <LoadingState text="이 화면을 닫지 말아 주세요." />
      </EmptyState>
    );
  }

  if (state.stage === CheckoutResultStage.PAYMENT_FAILED) {
    return (
      <EmptyState
        label="결제 실패"
        title="결제가 완료되지 않았어요."
        description="작성한 근무표는 그대로 있어요."
      >
        <Link href={buildCheckoutHref(query.yearMonth, state.draftId)} className="primary">
          다시 결제하기
        </Link>
        <Link href={draftHref} className="secondary">
          근무표로 돌아가기
        </Link>
      </EmptyState>
    );
  }

  if (state.stage === CheckoutResultStage.PUBLISH_FAILED) {
    return (
      <EmptyState
        label="결제 완료"
        title="결제는 완료됐어요."
        description="저장을 다시 시도해 주세요. 다시 결제하지 않아도 돼요."
      >
        {state.error && (
          <div className="warning" role="alert">
            {state.error}
          </div>
        )}
        <button type="button" className="primary" onClick={state.handleRetryPublish}>
          저장 다시 시도
        </button>
        <Link href={draftHref} className="secondary">
          근무표 확인하기
        </Link>
      </EmptyState>
    );
  }

  if (state.stage === CheckoutResultStage.CONFIRM_FAILED) {
    return (
      <EmptyState
        label="결제 확인"
        title="결제 결과를 확인하지 못했어요"
        description="같은 결제로 다시 확인해요. 중복으로 청구되지 않아요."
      >
        {state.error && (
          <div className="warning" role="alert">
            {state.error}
          </div>
        )}
        <button type="button" className="primary" onClick={state.handleRetryConfirm}>
          다시 확인하기
        </button>
        <Link href={draftHref} className="secondary">
          근무표로 돌아가기
        </Link>
      </EmptyState>
    );
  }

  return (
    <EmptyState
      label="결제 완료"
      title="이용권을 구매했어요"
      description="이제 이 달을 저장하고 공유할 수 있어요."
    >
      <Link href="/calendar" className="primary">
        내 달력 보기
      </Link>
    </EmptyState>
  );
};

export default CheckoutResultView;

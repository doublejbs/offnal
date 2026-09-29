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
  const { outcome, draftId, handleRetryConfirm, handleRetryPublish } = useCheckoutResultState(query);
  const draftHref = draftId ? `/drafts/${draftId}` : '/calendar';
  const retryCheckoutHref = buildCheckoutHref(query.yearMonth, draftId);
  const errorBox = outcome.message && (
    <div className="warning" role="alert">
      {outcome.message}
      {outcome.providerCode && <div className="tiny mt-8">오류 코드: {outcome.providerCode}</div>}
    </div>
  );

  if (outcome.stage === CheckoutResultStage.CONFIRMING || outcome.stage === CheckoutResultStage.PUBLISHING) {
    return (
      <EmptyState
        label="결제 확인"
        title={
          outcome.stage === CheckoutResultStage.CONFIRMING
            ? '결제를 확인하고 있어요'
            : '달력에 저장하고 있어요'
        }
      >
        <LoadingState text="이 화면을 닫지 말아 주세요." />
      </EmptyState>
    );
  }

  if (outcome.stage === CheckoutResultStage.PENDING_DEPOSIT) {
    return (
      <EmptyState
        label="입금 대기"
        title="입금을 기다리고 있어요"
        description="입금이 확인되면 이 달을 저장할 수 있어요. 입금 확인에는 시간이 걸릴 수 있어요. 작성한 근무표는 그대로 있어요."
      >
        <Link href={draftHref} className="primary" replace>
          근무표로 돌아가기
        </Link>
      </EmptyState>
    );
  }

  if (outcome.stage === CheckoutResultStage.PAYMENT_FAILED) {
    return (
      <EmptyState
        label="결제 실패"
        title="결제가 완료되지 않았어요."
        description="작성한 근무표는 그대로 있어요."
      >
        {errorBox}
        <Link href={retryCheckoutHref} className="primary" replace>
          다시 결제하기
        </Link>
        <Link href={draftHref} className="secondary" replace>
          근무표로 돌아가기
        </Link>
      </EmptyState>
    );
  }

  if (outcome.stage === CheckoutResultStage.ORDER_CLOSED) {
    return (
      <EmptyState
        label="주문 종료"
        title="이 주문은 더 이상 결제할 수 없어요"
        description="새 주문으로 결제를 다시 시작해 주세요. 작성한 근무표는 그대로 있어요."
      >
        <Link href={retryCheckoutHref} className="primary" replace>
          결제 다시 시작
        </Link>
        <Link href={draftHref} className="secondary" replace>
          근무표로 돌아가기
        </Link>
      </EmptyState>
    );
  }

  if (outcome.stage === CheckoutResultStage.PUBLISH_FAILED) {
    return (
      <EmptyState
        label="결제 완료"
        title="결제는 완료됐어요. 저장을 다시 시도해 주세요."
        description="다시 결제하지 않아도 돼요."
      >
        {errorBox}
        <button type="button" className="primary" onClick={handleRetryPublish}>
          저장 다시 시도
        </button>
        <Link href={draftHref} className="secondary">
          근무표 확인하기
        </Link>
      </EmptyState>
    );
  }

  if (outcome.stage === CheckoutResultStage.CONFIRM_FAILED) {
    return (
      <EmptyState
        label="결제 확인"
        title="결제 결과를 아직 확인하지 못했어요"
        description="같은 주문으로 다시 확인해요. 중복으로 결제되지 않아요."
      >
        {errorBox}
        <button type="button" className="primary" onClick={handleRetryConfirm}>
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
      <Link href="/calendar" className="primary" replace>
        내 달력 보기
      </Link>
    </EmptyState>
  );
};

export default CheckoutResultView;

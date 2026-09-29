'use client';

import Link from 'next/link';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import AuthRequired from '@/components/AuthRequired';
import BackLink from '@/components/BackLink';
import CheckoutReceipt from '@/components/checkout/CheckoutReceipt';
import { useMonthCheckoutState } from '@/components/checkout/UseMonthCheckoutState';
import { usePublicConfig } from '@/components/ConfigProvider';
import LoadingState from '@/components/LoadingState';
import { CheckoutStage } from '@/domain/enums/CheckoutStage';
import { formatYearMonthLabel, parseYearMonth } from '@/domain/YearMonth';

type MonthCheckoutProps = {
  yearMonth: string;
  draftId: string | null;
};

const TOSS_STAGES = [CheckoutStage.TOSS_LOADING, CheckoutStage.TOSS_READY, CheckoutStage.REQUESTING];

/** Single-month purchase. Mock mode shows clearly labelled test buttons; nothing claims success locally. */
const MonthCheckout = ({ yearMonth, draftId }: MonthCheckoutProps) => {
  const { freeMonthLimit, priceKrw } = usePublicConfig();
  const state = useMonthCheckoutState(yearMonth, draftId);
  const parts = parseYearMonth(yearMonth);
  const backHref = draftId ? `/drafts/${draftId}` : '/calendar';
  const amount = state.payment?.amount ?? priceKrw;
  const price = formatPrice(amount);

  if (!parts) {
    return (
      <div className="warning" role="alert">
        대상 월이 올바르지 않아요.
      </div>
    );
  }

  if (state.stage === CheckoutStage.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`/checkout/${yearMonth}${draftId ? `?draftId=${draftId}` : ''}`} />;
  }

  if (state.stage === CheckoutStage.FREE_MONTH_AVAILABLE) {
    return (
      <>
        <BackLink href={backHref} />
        <div className="label">무료로 저장할 수 있어요</div>
        <h1>이 달은 결제하지 않아도 돼요.</h1>
        <p>
          아직 무료 월이 남아 있어서 {formatYearMonthLabel(yearMonth)}은 무료로 저장돼요. 근무표로 돌아가
          저장해 주세요.
        </p>
        <Link href={backHref} className="primary" replace>
          {draftId ? '근무표로 돌아가 무료로 저장' : '내 달력으로'}
        </Link>
      </>
    );
  }

  if (state.stage === CheckoutStage.ENTITLED) {
    return (
      <>
        <div className="label">이미 이용권이 있는 달이에요</div>
        <h1>추가 결제 없이 저장할게요.</h1>
        {state.error ? (
          <>
            <div className="warning" role="alert">
              {state.error}
            </div>
            <Link href={backHref} className="primary" replace>
              근무표로 돌아가기
            </Link>
          </>
        ) : (
          <LoadingState text="달력에 저장하는 중이에요…" />
        )}
      </>
    );
  }

  const label =
    state.freeRemaining === 0
      ? `무료 ${formatMonthCount(freeMonthLimit)}을 모두 이용했어요`
      : `${formatYearMonthLabel(yearMonth)} 이용권`;

  return (
    <>
      <BackLink href={backHref} />
      <div className="label">{label}</div>
      <h1>
        필요한 달만,
        <br />
        가볍게 이어가세요.
      </h1>
      {draftId && (
        <p>
          {parts.month}월 근무표 확인을 마쳤어요.
          <br />
          구매하면 저장하고 공유할 수 있어요.
        </p>
      )}
      <CheckoutReceipt yearMonth={yearMonth} amount={amount} />
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      {state.stage === CheckoutStage.CREATING && <LoadingState text="주문을 준비하는 중이에요…" />}
      {state.stage === CheckoutStage.ERROR && (
        <button type="button" className="primary" onClick={state.handleRetry}>
          다시 시도
        </button>
      )}
      {state.stage === CheckoutStage.MOCK_READY && (
        <div className="block mt-0">
          <span className="test-badge">테스트 결제 · 실제 청구 없음</span>
          <p className="mt-0">개발 데모에서는 결제 결과를 직접 선택해요. 실제 카드 결제는 일어나지 않아요.</p>
          <div className="stack">
            <button type="button" className="primary" onClick={() => state.handleMockResult(true)}>
              테스트 결제 성공
            </button>
            <button type="button" className="secondary" onClick={() => state.handleMockResult(false)}>
              테스트 결제 실패
            </button>
          </div>
        </div>
      )}
      {TOSS_STAGES.includes(state.stage) && (
        <div>
          <div id={state.methodsId} />
          <div id={state.agreementId} />
          <button
            type="button"
            className="primary"
            onClick={state.handleTossPay}
            disabled={state.stage !== CheckoutStage.TOSS_READY}
          >
            {state.stage === CheckoutStage.TOSS_LOADING
              ? '결제 화면을 불러오는 중…'
              : `${price} 결제하고 저장`}
          </button>
        </div>
      )}
      <div className="center">
        <Link href={backHref} className="textbutton">
          나중에 할게요
        </Link>
      </div>
      <div className="hint">구매하지 않아도 기존 달력은 그대로 볼 수 있어요.</div>
    </>
  );
};

export default MonthCheckout;

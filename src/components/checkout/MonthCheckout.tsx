'use client';

import Link from 'next/link';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import AuthRequired from '@/components/AuthRequired';
import BackLink from '@/components/BackLink';
import {
  TOSS_AGREEMENT_ID,
  TOSS_METHODS_ID,
  useMonthCheckoutState,
} from '@/components/checkout/UseMonthCheckoutState';
import { usePublicConfig } from '@/components/ConfigProvider';
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

  if (state.isAuthRequired) {
    return <AuthRequired returnTo={`/checkout/${yearMonth}${draftId ? `?draftId=${draftId}` : ''}`} />;
  }

  return (
    <>
      <BackLink href={backHref} />
      <div className="label">무료 {formatMonthCount(freeMonthLimit)}을 모두 이용했어요</div>
      <h1>
        필요한 달만,
        <br />
        가볍게 이어가세요.
      </h1>
      <p>
        {parts.month}월 근무표 확인을 마쳤어요.
        <br />
        구매하면 저장하고 공유할 수 있어요.
      </p>
      <div className="block">
        <div className="tiny">{formatYearMonthLabel(yearMonth)} 이용권</div>
        <div className="price">
          {amount.toLocaleString('ko-KR')}
          <span>원</span>
        </div>
        <div className="receipt">
          <span>이번 달 근무표 저장</span>
          <span>포함</span>
        </div>
        <div className="receipt">
          <span>캘린더 추가 · 링크 · 이미지</span>
          <span>포함</span>
        </div>
        <div className="receipt">
          <span>같은 달 근무 수정</span>
          <span>포함</span>
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 13 }}>단건 구매예요. 다음 달 자동 결제는 없어요.</p>
      </div>
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      {state.stage === CheckoutStage.ALREADY_ENTITLED && (
        <div className="notice" role="status">
          이미 이용권이 있는 달이에요. 추가 결제 없이 저장할 수 있어요.
          <Link href={backHref} className="primary" style={{ marginTop: 10 }}>
            돌아가서 저장하기
          </Link>
        </div>
      )}
      {(state.stage === CheckoutStage.IDLE ||
        state.stage === CheckoutStage.CREATING ||
        state.stage === CheckoutStage.ERROR) && (
        <button
          type="button"
          className="primary"
          onClick={state.handleStart}
          disabled={state.stage === CheckoutStage.CREATING}
        >
          {state.stage === CheckoutStage.CREATING ? '주문을 만드는 중…' : `${price} 결제하고 저장`}
        </button>
      )}
      {state.stage === CheckoutStage.MOCK_READY && (
        <div className="block" style={{ marginTop: 0 }}>
          <span className="test-badge">테스트 결제 · 실제 청구 없음</span>
          <p style={{ marginTop: 0 }}>
            개발 데모에서는 결제 결과를 직접 선택해요. 실제 카드 결제는 일어나지 않아요.
          </p>
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
          <div id={TOSS_METHODS_ID} />
          <div id={TOSS_AGREEMENT_ID} />
          <button
            type="button"
            className="primary"
            onClick={state.handleTossPay}
            disabled={state.stage !== CheckoutStage.TOSS_READY}
          >
            {state.stage === CheckoutStage.TOSS_LOADING ? '결제 화면을 불러오는 중…' : `${price} 결제하기`}
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

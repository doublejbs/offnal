'use client';

import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import { WEEKDAY_LABELS } from '@/client/MonthLayout';
import { usePublicConfig } from '@/components/ConfigProvider';
import LoginOptions from '@/components/LoginOptions';

const PLACEHOLDER_CELL_COUNT = 35;
const PLACEHOLDER_CELLS = Array.from({ length: PLACEHOLDER_CELL_COUNT }, (_, index) => index);

type BlurredPreviewGateProps = {
  recognitionId: string;
  loginFailed: boolean;
};

/**
 * Shown after a successful first pass to a visitor who is not logged in. The blurred calendar is a
 * fixed neutral placeholder: no recognition data exists on this page (the status API has none).
 */
const BlurredPreviewGate = ({ recognitionId, loginFailed }: BlurredPreviewGateProps) => {
  const { freeMonthLimit, priceKrw } = usePublicConfig();

  return (
    <section aria-labelledby="gate-title">
      <div className="label">근무표 인식 완료</div>
      <h1 id="gate-title">
        근무표를 읽었어요.
        <br />내 달력을 확인해 보세요.
      </h1>
      <p>
        로그인하면 내 이름을 선택하고
        <br />
        근무를 확인·수정할 수 있어요.
      </p>
      {loginFailed && (
        <div className="warning" role="alert">
          로그인이 완료되지 않았어요. 사진은 그대로 있으니 다시 시도해 주세요.
        </div>
      )}
      <div className="teaser">
        <div className="teaser-content" aria-hidden="true">
          <div className="week">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="fake-grid">
            {PLACEHOLDER_CELLS.map((index) => (
              <div key={index} className="fake-cell">
                <span />
              </div>
            ))}
          </div>
        </div>
        <div className="teaser-lock">
          <span className="lock-label">
            <LockKeyhole size={18} aria-hidden="true" />
            로그인하고 내 근무 확인
          </span>
        </div>
      </div>
      <LoginOptions returnTo={`/recognitions/${recognitionId}`} primaryLabel="로그인하고 무료로 확인" />
      <div className="hint">
        처음 {formatMonthCount(freeMonthLimit)} 무료 · 카드 등록 없이 시작
        <br />
        그다음 달부터 한 달분 {formatPrice(priceKrw)} · 자동 결제 없음
      </div>
      <div className="notice">
        업로드한 사진은 다시 올리지 않아도 돼요.
        <br />
        로그인 후 이어서 확인할 수 있어요.
      </div>
      <div className="center">
        <Link href="/" className="textbutton">
          다른 사진 올리기
        </Link>
      </div>
    </section>
  );
};

export default BlurredPreviewGate;

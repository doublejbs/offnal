import Link from 'next/link';
import { type RefObject } from 'react';

import { SAMPLE_DEFINITIONS } from '@/client/SamplePreviewData';
import { SAMPLE_TRY_CTA_TEXT } from '@/client/SampleTryCopy';
import { findSamplePerson, SAMPLE_TRY_YEAR_MONTH } from '@/client/SampleTryData';
import { type SampleTryState } from '@/client/SampleTryFlow';
import MonthGrid from '@/components/calendar/MonthGrid';
import SampleBackButtonView from '@/components/try/SampleBackButtonView';
import LandingShareView from '@/components/upload/LandingShareView';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type SampleDoneStepViewProps = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  state: SampleTryState;
  /** Where "내 근무표로 만들기" goes: the upload box of the entry screen. */
  ctaHref: string;
  onCtaClick: () => void;
  onBack: () => void;
};

/**
 * Step 4: the finished month and what a real calendar can do — explained in text only, no look-alike buttons
 * (nothing is saved in the trial). The only action is making one from the user's own roster.
 */
const SampleDoneStepView = ({ headingRef, state, ctaHref, onCtaClick, onBack }: SampleDoneStepViewProps) => (
  <>
    <SampleBackButtonView label="결과 다시 확인" onBack={onBack} />
    <div className="label">4 / 4 · 완성</div>
    <h1 ref={headingRef} tabIndex={-1}>
      내 근무 달력이
      <br />
      만들어졌어요.
    </h1>
    <div className="tiny">
      {findSamplePerson(state.entriesRowId).name} · {formatYearMonthLabel(SAMPLE_TRY_YEAR_MONTH)} · 예시
    </div>
    <div className="mt-14">
      <MonthGrid
        yearMonth={SAMPLE_TRY_YEAR_MONTH}
        entries={state.entries}
        definitions={SAMPLE_DEFINITIONS}
        selectedDate={null}
        showToday={false}
      />
    </div>
    <p className="mt-14 keep-all">실제로 만든 달력에서는 공유 링크·캘린더 추가·이미지 저장을 할 수 있어요.</p>
    <div className="keep-all">
      <LandingShareView title="완성한 달력은 이렇게 써요" />
    </div>
    <Link href={ctaHref} className="primary" prefetch={false} onClick={onCtaClick}>
      {SAMPLE_TRY_CTA_TEXT}
    </Link>
    <div className="hint keep-all">내 근무표 사진을 올리면 같은 순서로 내 달력이 만들어져요.</div>
  </>
);

export default SampleDoneStepView;

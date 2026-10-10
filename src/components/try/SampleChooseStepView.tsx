import { type RefObject } from 'react';

import { SAMPLE_TRY_CANDIDATES } from '@/client/SampleTryData';
import CandidateList from '@/components/select/CandidateList';
import SampleBackButtonView from '@/components/try/SampleBackButtonView';

type SampleChooseStepViewProps = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  selectedRowId: string;
  onSelect: (rowId: string) => void;
  onNext: () => void;
  onBack: () => void;
};

/** Step 2: pick a name from the recognized (fictional) list, the same radio rows as the real select page. */
const SampleChooseStepView = ({
  headingRef,
  selectedRowId,
  onSelect,
  onNext,
  onBack,
}: SampleChooseStepViewProps) => (
  <>
    <SampleBackButtonView label="근무표 다시 보기" onBack={onBack} />
    <div className="label">2 / 4 · 내 근무 찾기</div>
    <h1 ref={headingRef} tabIndex={-1}>
      어느 분의 근무표인가요?
    </h1>
    <p>예시라서 아무 이름이나 골라도 돼요.</p>
    <CandidateList
      candidates={SAMPLE_TRY_CANDIDATES}
      selectedRowId={selectedRowId}
      disabled={false}
      onSelect={onSelect}
    />
    <div className="pt-20">
      <button type="button" className="primary" onClick={onNext}>
        내 근무 확인하기
      </button>
    </div>
  </>
);

export default SampleChooseStepView;

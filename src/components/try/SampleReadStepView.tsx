import { type RefObject } from 'react';

import {
  SAMPLE_ROSTER,
  SAMPLE_TRY_IMAGE_ALT,
  SAMPLE_TRY_IMAGE_PATH,
  SAMPLE_TRY_IMAGE_ZOOM,
} from '@/client/SampleTryData';
import BackLink from '@/components/BackLink';
import SourcePreview from '@/components/SourcePreview';

type SampleReadStepViewProps = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onNext: () => void;
};

/** Step 1: the fictional roster photo, already "read" — like the screen after a real first pass. */
const SampleReadStepView = ({ headingRef, onNext }: SampleReadStepViewProps) => (
  <>
    <BackLink href="/" label="처음으로" prefetch={false} />
    <div className="label">1 / 4 · 근무표 읽기</div>
    <h1 ref={headingRef} tabIndex={-1}>
      근무표를 읽었어요.
    </h1>
    <p>
      예시 병동 근무표에서 이름 {SAMPLE_ROSTER.length}명과
      <br />
      11월 한 달 근무를 찾았어요.
    </p>
    <SourcePreview
      src={SAMPLE_TRY_IMAGE_PATH}
      alt={SAMPLE_TRY_IMAGE_ALT}
      initialZoom={SAMPLE_TRY_IMAGE_ZOOM}
    />
    <div className="tiny mt-10">사진을 좌우로 밀거나 확대·축소해서 볼 수 있어요.</div>
    <div className="pt-20">
      <button type="button" className="primary" onClick={onNext}>
        내 이름 고르기
      </button>
    </div>
  </>
);

export default SampleReadStepView;

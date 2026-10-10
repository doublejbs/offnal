'use client';

import { FlaskConical } from 'lucide-react';

import { SAMPLE_TRY_NOTICE, SAMPLE_TRY_UPLOAD_HREF } from '@/client/SampleTryCopy';
import SampleChooseStepView from '@/components/try/SampleChooseStepView';
import SampleDoneStepView from '@/components/try/SampleDoneStepView';
import SampleReadStepView from '@/components/try/SampleReadStepView';
import SampleReviewStepView from '@/components/try/SampleReviewStepView';
import { useSampleTryState } from '@/components/try/UseSampleTryState';
import { SampleTryStep } from '@/domain/enums/SampleTryStep';

/** Sample roster trial (Spec §26.3): client-only, nothing is uploaded, recognized or saved. */
const SampleTryScreen = () => {
  const {
    state,
    headingRef,
    handleNext,
    handleBack,
    handleSelectPerson,
    handleSelectDate,
    handleSelectCode,
    handleCtaClick,
  } = useSampleTryState();

  return (
    <>
      <div className="sample-try-notice" role="note">
        <FlaskConical size={16} aria-hidden="true" />
        {SAMPLE_TRY_NOTICE}
      </div>
      {state.step === SampleTryStep.READ && (
        <SampleReadStepView headingRef={headingRef} onNext={handleNext} />
      )}
      {state.step === SampleTryStep.CHOOSE && (
        <SampleChooseStepView
          headingRef={headingRef}
          selectedRowId={state.selectedRowId}
          onSelect={handleSelectPerson}
          onNext={handleNext}
          onBack={handleBack}
        />
      )}
      {state.step === SampleTryStep.REVIEW && (
        <SampleReviewStepView
          headingRef={headingRef}
          state={state}
          onSelectDate={handleSelectDate}
          onSelectCode={handleSelectCode}
          onNext={handleNext}
          onBack={handleBack}
        />
      )}
      {state.step === SampleTryStep.DONE && (
        <SampleDoneStepView
          headingRef={headingRef}
          state={state}
          ctaHref={SAMPLE_TRY_UPLOAD_HREF}
          onCtaClick={handleCtaClick}
          onBack={handleBack}
        />
      )}
    </>
  );
};

export default SampleTryScreen;

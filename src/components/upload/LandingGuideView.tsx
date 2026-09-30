import { buildLandingFaqs, type LandingCopySource } from '@/client/LandingCopy';
import LandingFaqView from '@/components/upload/LandingFaqView';
import LandingRecipientView from '@/components/upload/LandingRecipientView';
import LandingShareView from '@/components/upload/LandingShareView';
import LandingStepsView from '@/components/upload/LandingStepsView';

type LandingGuideViewProps = LandingCopySource;

/** Signed-out service guide under the upload box (Spec §17): how it works, sharing, recipients, FAQ. */
const LandingGuideView = ({ freeMonthLimit, priceKrw, sourceTtlHours }: LandingGuideViewProps) => {
  const faqs = buildLandingFaqs({ freeMonthLimit, priceKrw, sourceTtlHours });

  return (
    <div className="landing-guide">
      <LandingStepsView />
      <LandingShareView />
      <LandingRecipientView />
      <LandingFaqView faqs={faqs} />
    </div>
  );
};

export default LandingGuideView;

import { buildLandingFaqs, type LandingCopySource } from '@/client/LandingCopy';
import LandingFaqView from '@/components/upload/LandingFaqView';
import LandingRecipientView from '@/components/upload/LandingRecipientView';
import LandingShareView from '@/components/upload/LandingShareView';
import LandingStepsView from '@/components/upload/LandingStepsView';
import LandingTeamView from '@/components/upload/LandingTeamView';

type LandingGuideViewProps = LandingCopySource & {
  isTeamComingSoon: boolean;
};

/** Signed-out service guide under the upload box (Spec §17): how it works, sharing, recipients, team sharing (beta), FAQ. */
const LandingGuideView = ({
  billingMode,
  freeMonthLimit,
  priceKrw,
  sourceTtlHours,
  isTeamComingSoon,
}: LandingGuideViewProps) => {
  const faqs = buildLandingFaqs({ billingMode, freeMonthLimit, priceKrw, sourceTtlHours });

  return (
    <div className="landing-guide">
      <LandingStepsView />
      <LandingShareView />
      <LandingRecipientView />
      <LandingTeamView billingMode={billingMode} isTeamComingSoon={isTeamComingSoon} />
      <LandingFaqView faqs={faqs} />
    </div>
  );
};

export default LandingGuideView;

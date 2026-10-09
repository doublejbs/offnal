import Link from 'next/link';
import { useId } from 'react';

import { getLandingTeamText, LANDING_TEAM_TITLE } from '@/client/LandingCopy';
import { TEAM_COMING_SOON_CHIP } from '@/client/TeamComingSoonCopy';
import { type BillingMode } from '@/domain/enums/BillingMode';

type LandingTeamViewProps = {
  billingMode: BillingMode;
  /** Team "준비 중" mode: a small chip next to the title and no way in (Spec §24.2). */
  isTeamComingSoon: boolean;
};

/** "팀 전체가 함께 쓰려면": one line about team sharing (beta, free; no price in beta free mode) with a way in. */
const LandingTeamView = ({ billingMode, isTeamComingSoon }: LandingTeamViewProps) => {
  const titleId = useId();

  return (
    <section className="landing-section" aria-labelledby={titleId}>
      <h2 id={titleId}>
        {LANDING_TEAM_TITLE}
        {isTeamComingSoon && <span className="soon-chip">{TEAM_COMING_SOON_CHIP}</span>}
      </h2>
      <p className="mb-8">{getLandingTeamText(billingMode)}</p>
      {!isTeamComingSoon && (
        <Link href="/teams" className="textbutton">
          팀 공유 알아보기
        </Link>
      )}
    </section>
  );
};

export default LandingTeamView;

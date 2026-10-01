import Link from 'next/link';
import { useId } from 'react';

import { LANDING_TEAM_TEXT, LANDING_TEAM_TITLE } from '@/client/LandingCopy';

/** "팀 전체가 함께 쓰려면": one line about team sharing (beta, free) with a way in. */
const LandingTeamView = () => {
  const titleId = useId();

  return (
    <section className="landing-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{LANDING_TEAM_TITLE}</h2>
      <p className="mb-8">{LANDING_TEAM_TEXT}</p>
      <Link href="/teams" className="textbutton">
        팀 공유 알아보기
      </Link>
    </section>
  );
};

export default LandingTeamView;

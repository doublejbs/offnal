import { useId } from 'react';

import { LANDING_RECIPIENT_POINTS, LANDING_RECIPIENT_TITLE } from '@/client/LandingCopy';

/** "공유받은 사람은": what a link recipient can and cannot see. */
const LandingRecipientView = () => {
  const titleId = useId();

  return (
    <section className="block landing-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{LANDING_RECIPIENT_TITLE}</h2>
      <ul className="landing-points">
        {LANDING_RECIPIENT_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </section>
  );
};

export default LandingRecipientView;

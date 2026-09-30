import { useId } from 'react';

import { LANDING_STEPS, LANDING_STEPS_TITLE } from '@/client/LandingCopy';

/** "이렇게 써요": three numbered steps from photo to saved calendar. */
const LandingStepsView = () => {
  const titleId = useId();

  return (
    <section className="block landing-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{LANDING_STEPS_TITLE}</h2>
      <ol className="landing-steps">
        {LANDING_STEPS.map((step, index) => (
          <li key={step.title} className="landing-step">
            <span className="landing-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="landing-item-body">
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default LandingStepsView;

import { ChevronDown } from 'lucide-react';
import { useId } from 'react';

import { type LandingFaq, LANDING_FAQ_TITLE } from '@/client/LandingCopy';

type LandingFaqViewProps = {
  faqs: LandingFaq[];
};

/** "자주 묻는 질문": native <details> so each answer opens with keyboard and screen readers without script. */
const LandingFaqView = ({ faqs }: LandingFaqViewProps) => {
  const titleId = useId();

  return (
    <section className="landing-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{LANDING_FAQ_TITLE}</h2>
      <div className="landing-faqs">
        {faqs.map((faq) => (
          <details key={faq.question} className="landing-faq">
            <summary>
              <span>{faq.question}</span>
              <ChevronDown size={18} className="landing-faq-chevron" aria-hidden="true" />
            </summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
};

export default LandingFaqView;

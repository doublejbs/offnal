import { CalendarPlus, Image as ImageIcon, Link as LinkIcon, type LucideIcon } from 'lucide-react';
import { useId } from 'react';

import { LANDING_SHARE_METHODS, LANDING_SHARE_TITLE } from '@/client/LandingCopy';
import { ExportPanel } from '@/domain/enums/ExportPanel';

const METHOD_ICONS: Record<ExportPanel, LucideIcon> = {
  [ExportPanel.LINK]: LinkIcon,
  [ExportPanel.ICS]: CalendarPlus,
  [ExportPanel.PNG]: ImageIcon,
};

/** "이렇게 공유해요": link, one-time calendar import (ICS), and calendar image. */
const LandingShareView = () => {
  const titleId = useId();

  return (
    <section className="landing-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{LANDING_SHARE_TITLE}</h2>
      <ul className="landing-methods">
        {LANDING_SHARE_METHODS.map((item) => {
          const Icon = METHOD_ICONS[item.method];

          return (
            <li key={item.method} className="landing-method">
              <span className="landing-method-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <div className="landing-item-body">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default LandingShareView;

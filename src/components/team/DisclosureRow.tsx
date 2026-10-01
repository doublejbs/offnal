'use client';

import { type ReactNode, useId } from 'react';

type DisclosureRowProps = {
  isOpen: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  /** Extra text after the title, e.g. "요청 2". */
  badge?: string | null;
  onToggle: () => void;
  children: ReactNode;
};

/** Row button that opens its panel right under itself (same look as the share screen's ExportRow). */
const DisclosureRow = ({
  isOpen,
  icon,
  title,
  description,
  badge,
  onToggle,
  children,
}: DisclosureRowProps) => {
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        className="rowbutton"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={onToggle}
      >
        {icon}
        <span className="min-w-0">
          <strong>
            {title}
            {badge && <span className="count-badge">{badge}</span>}
          </strong>
          <small>{description}</small>
        </span>
      </button>
      {isOpen && (
        <div id={panelId} className="panel">
          {children}
        </div>
      )}
    </div>
  );
};

export default DisclosureRow;

'use client';

import { type ReactNode, useId } from 'react';

import { type ExportPanel } from '@/domain/enums/ExportPanel';

type ExportRowProps = {
  panel: ExportPanel;
  openPanel: ExportPanel | null;
  icon: ReactNode;
  title: string;
  description: string;
  onToggle: (panel: ExportPanel) => void;
  children: ReactNode;
};

/** One export action as a disclosure row: the panel opens right under its own button. */
const ExportRow = ({ panel, openPanel, icon, title, description, onToggle, children }: ExportRowProps) => {
  const panelId = useId();
  const isOpen = openPanel === panel;

  return (
    <div>
      <button
        type="button"
        className="rowbutton"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => onToggle(panel)}
      >
        {icon}
        <span>
          <strong>{title}</strong>
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

export default ExportRow;

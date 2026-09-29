import { type ReactNode } from 'react';

type EmptyStateProps = {
  label?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
};

const EmptyState = ({ label, title, description, children }: EmptyStateProps) => (
  <section aria-labelledby="empty-title">
    {label && <div className="label">{label}</div>}
    <h1 id="empty-title">{title}</h1>
    {description && <p>{description}</p>}
    {children && <div className="stack">{children}</div>}
  </section>
);

export default EmptyState;

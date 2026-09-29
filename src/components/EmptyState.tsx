import { type ReactNode, useId } from 'react';

type EmptyStateProps = {
  label?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
};

const EmptyState = ({ label, title, description, children }: EmptyStateProps) => {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId}>
      {label && <div className="label">{label}</div>}
      <h1 id={titleId}>{title}</h1>
      {description && <p>{description}</p>}
      {children && <div className="stack">{children}</div>}
    </section>
  );
};

export default EmptyState;

import { type ReactNode } from 'react';

type ExportFeedbackViewProps = {
  error: string | null;
  message: string | null;
  /** The panel's action button, placed between the error alert and the status line. */
  children: ReactNode;
};

/** Error alert, action and polite status line, laid out the same in every export panel. */
const ExportFeedbackView = ({ error, message, children }: ExportFeedbackViewProps) => (
  <>
    {error && (
      <div className="warning" role="alert">
        {error}
      </div>
    )}
    {children}
    <div className="status-line mt-8" role="status" aria-live="polite">
      {message}
    </div>
  </>
);

export default ExportFeedbackView;

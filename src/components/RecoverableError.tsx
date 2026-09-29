import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';

type RecoverableErrorProps = {
  title: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  /** Secondary escape route, e.g. uploading another photo. */
  alternativeHref?: string;
  alternativeLabel?: string;
};

/** A failure with its cause in words and a way forward (retry and/or an alternative path). */
const RecoverableError = ({
  title,
  message,
  retryLabel = '다시 시도',
  onRetry,
  isRetrying = false,
  alternativeHref,
  alternativeLabel,
}: RecoverableErrorProps) => (
  <section aria-labelledby="error-title">
    <div className="label">처리하지 못했어요</div>
    <h1 id="error-title">{title}</h1>
    <div className="warning" role="alert">
      <TriangleAlert size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
      {message}
    </div>
    <div className="stack">
      {onRetry && (
        <button type="button" className="primary" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? '다시 시도하는 중…' : retryLabel}
        </button>
      )}
      {alternativeHref && alternativeLabel && (
        <Link href={alternativeHref} className={onRetry ? 'secondary' : 'primary'}>
          {alternativeLabel}
        </Link>
      )}
    </div>
  </section>
);

export default RecoverableError;

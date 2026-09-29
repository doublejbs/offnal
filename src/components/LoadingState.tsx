import { LoaderCircle } from 'lucide-react';

type LoadingStateProps = {
  text?: string;
};

const LoadingState = ({ text = '불러오는 중이에요…' }: LoadingStateProps) => (
  <p role="status" aria-live="polite" className="loading-line">
    <LoaderCircle size={18} aria-hidden="true" className="spin" />
    {text}
  </p>
);

export default LoadingState;

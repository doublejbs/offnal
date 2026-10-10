import { ChevronLeft } from 'lucide-react';

type SampleBackButtonViewProps = {
  label: string;
  onBack: () => void;
};

/** Same look as `BackLink`, but steps back inside the sample trial instead of leaving the page. */
const SampleBackButtonView = ({ label, onBack }: SampleBackButtonViewProps) => (
  <button type="button" className="back" onClick={onBack}>
    <ChevronLeft size={18} aria-hidden="true" />
    {label}
  </button>
);

export default SampleBackButtonView;

import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';

type DraftHeaderFieldsProps = {
  displayName: string;
  monthInput: string;
  monthError: string | null;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onMonthChange: (value: string) => void;
};

/** Name and month are editable; a month change re-maps dates on the server by day number. */
const DraftHeaderFields = ({
  displayName,
  monthInput,
  monthError,
  disabled,
  onNameChange,
  onMonthChange,
}: DraftHeaderFieldsProps) => (
  <div className="time-grid my-12">
    <label className="inline-field">
      이름
      <input
        value={displayName}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        disabled={disabled}
        onChange={(event) => onNameChange(event.target.value)}
      />
    </label>
    <label className="inline-field">
      대상 월
      <input
        type="month"
        value={monthInput}
        disabled={disabled}
        onChange={(event) => onMonthChange(event.target.value)}
      />
    </label>
    {monthError && (
      <div className="status-line span-all" data-tone="warn" role="alert">
        {monthError}
      </div>
    )}
  </div>
);

export default DraftHeaderFields;

'use client';

import { type FormEvent, useId, useState } from 'react';

import { MAX_LABEL_LENGTH } from '@/domain/DomainLimits';
import { MAX_CODE_LENGTH } from '@/domain/ScheduleValidator';

type AddCodeFormProps = {
  submitLabel: string;
  /** Returns an error message, or null when the code was added. */
  onAdd: (code: string, label: string) => string | null;
  disabled?: boolean;
  onCancel?: () => void;
};

/** Custom code (hospital-specific shifts, leave, training…). Times are set afterwards in the time editor. */
const AddCodeForm = ({ submitLabel, onAdd, disabled, onCancel }: AddCodeFormProps) => {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const message = onAdd(code, label);

    setError(message);

    if (!message && !disabled) {
      setCode('');
      setLabel('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stack mt-12" aria-label="근무 코드 추가">
      <div className="time-grid">
        <label className="inline-field">
          코드
          <input
            value={code}
            maxLength={MAX_CODE_LENGTH}
            disabled={disabled}
            onChange={(event) => setCode(event.target.value)}
            placeholder="예: VAC"
            aria-describedby={error ? errorId : undefined}
            autoCapitalize="characters"
          />
        </label>
        <label className="inline-field">
          이름
          <input
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            disabled={disabled}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="예: 휴가"
          />
        </label>
      </div>
      {error && (
        <div id={errorId} className="status-line" data-tone="warn" role="alert">
          {error}
        </div>
      )}
      <div className={onCancel ? 'actionrow' : undefined}>
        {onCancel && (
          <button type="button" className="secondary" disabled={disabled} onClick={onCancel}>
            취소
          </button>
        )}
        <button type="submit" className="primary" disabled={disabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
};

export default AddCodeForm;

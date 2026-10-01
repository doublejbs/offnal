'use client';

import { type FormEvent, useState } from 'react';

import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';

type RosterAddRowFormProps = {
  disabled: boolean;
  onAdd: (displayName: string) => Promise<boolean>;
};

/** "행 추가": a person missing from the photo (e.g. a new hire). Every date starts as "확인 필요". */
const RosterAddRowForm = ({ disabled, onAdd }: RosterAddRowFormProps) => {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (trimmed.length > 0 && (await onAdd(trimmed))) {
      setName('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="add-row-form" aria-label="행 추가">
      <label className="inline-field">
        사진에 없는 사람 추가
        <input
          value={name}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          placeholder="이름"
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button type="submit" className="secondary" disabled={disabled || trimmed.length === 0}>
        행 추가
      </button>
    </form>
  );
};

export default RosterAddRowForm;

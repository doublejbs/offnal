'use client';

import { type RefObject } from 'react';

import { type DefinitionPatch, isCodeUsed } from '@/client/DraftEditing';
import AddCodeForm from '@/components/draft/AddCodeForm';
import ShiftTimeRow from '@/components/draft/ShiftTimeRow';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

type ShiftTimeEditorProps = {
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
  /** Codes outside the legend still waiting for a definition: each row offers "휴무로 처리". */
  undefinedCodes: string[];
  isOpen: boolean;
  disabled: boolean;
  /** Drafts from a photo: the recognized times must be explicitly confirmed before saving. */
  requiresConfirmation: boolean;
  isConfirmed: boolean;
  summaryRef: RefObject<HTMLElement | null>;
  confirmRef: RefObject<HTMLInputElement | null>;
  rowsRef: RefObject<HTMLDivElement | null>;
  onToggle: (isOpen: boolean) => void;
  onConfirmChange: (isConfirmed: boolean) => void;
  onUpdate: (code: string, patch: DefinitionPatch) => void;
  onRemove: (code: string) => void;
  onAdd: (code: string, label: string) => string | null;
};

/** Times are never guessed: missing values stay empty until the user enters them. */
const ShiftTimeEditor = ({
  definitions,
  entries,
  undefinedCodes,
  isOpen,
  disabled,
  requiresConfirmation,
  isConfirmed,
  summaryRef,
  confirmRef,
  rowsRef,
  onToggle,
  onConfirmChange,
  onUpdate,
  onRemove,
  onAdd,
}: ShiftTimeEditorProps) => (
  <section aria-label="근무 시간" className="my-16">
    <details open={isOpen} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary ref={summaryRef} className="summary">
        근무 시간 확인 · 코드 관리
      </summary>
      <div ref={rowsRef} className="mt-8">
        {definitions.map((definition) => (
          <ShiftTimeRow
            key={definition.code}
            definition={definition}
            definitions={definitions}
            isUsed={isCodeUsed(entries, definition.code)}
            isUndefined={undefinedCodes.includes(definition.code)}
            disabled={disabled}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
        <AddCodeForm submitLabel="코드 추가" disabled={disabled} onAdd={onAdd} />
      </div>
    </details>
    {requiresConfirmation && (
      <label className="check notice">
        <input
          ref={confirmRef}
          type="checkbox"
          checked={isConfirmed}
          disabled={disabled}
          onChange={(event) => onConfirmChange(event.target.checked)}
        />
        <span>
          <strong>근무 시간을 확인했어요</strong>
          <span className="tiny block-text">
            사진에서 읽은 시간은 틀릴 수 있어요. 각 코드의 시작·종료 시각을 확인한 뒤 체크해 주세요.
          </span>
        </span>
      </label>
    )}
  </section>
);

export default ShiftTimeEditor;

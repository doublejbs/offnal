'use client';

import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

type TypedConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  /** The text to type before the danger button is enabled (e.g. the team name). */
  expectedText: string;
  inputLabel: string;
  confirmLabel: string;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** ConfirmDialog for irreversible actions: the confirm button stays disabled until `expectedText` is typed. */
const TypedConfirmDialog = ({
  isOpen,
  title,
  message,
  expectedText,
  inputLabel,
  confirmLabel,
  isBusy,
  onConfirm,
  onCancel,
}: TypedConfirmDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const messageId = useId();
  const isMatch = typed.trim() === expectedText.trim();

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (isOpen && !dialog.open) {
      dialog.showModal();
    }

    if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const handleCancel = (event: SyntheticEvent) => {
    event.preventDefault();

    if (!isBusy) {
      setTyped('');
      onCancel();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={handleCancel}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={messageId}>{message}</p>
      <label className="field">
        {inputLabel}
        <input
          value={typed}
          autoComplete="off"
          disabled={isBusy}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <div className="actionrow">
        <button type="button" className="secondary" onClick={handleCancel} disabled={isBusy}>
          취소
        </button>
        <button type="button" className="danger" onClick={onConfirm} disabled={isBusy || !isMatch}>
          {isBusy ? '처리 중…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
};

export default TypedConfirmDialog;

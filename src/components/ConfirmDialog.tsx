'use client';

import { type SyntheticEvent, useEffect, useRef } from 'react';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  isDanger?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Native modal <dialog>: focus trapping and Escape handling come from the browser. */
const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmLabel,
  isDanger = false,
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
    onCancel();
  };

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="confirm-title" onCancel={handleCancel}>
      <h2 id="confirm-title">{title}</h2>
      <p>{message}</p>
      <div className="actionrow">
        <button type="button" className="secondary" onClick={onCancel} disabled={isBusy}>
          취소
        </button>
        <button
          type="button"
          className={isDanger ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={isBusy}
        >
          {isBusy ? '처리 중…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
};

export default ConfirmDialog;

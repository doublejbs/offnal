'use client';

import { type SyntheticEvent, useEffect, useId, useRef } from 'react';

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

/** Native modal <dialog>: focus trapping comes from the browser; Escape cancels unless busy. */
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
  const titleId = useId();
  const messageId = useId();

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
    // The dialog stays open (and state-driven); Escape during a request does nothing.
    event.preventDefault();

    if (!isBusy) {
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

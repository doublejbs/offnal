'use client';

import { type RefObject, useEffect } from 'react';

/** `/#upload` (from the sample trial's "내 근무표로 만들기", Spec §26.3). */
export const UPLOAD_BOX_ID = 'upload';

/**
 * Arriving with `#upload`: bring the upload box into view and focus the file input (keyboard users can open
 * the picker right away). The picker itself is not opened — the navigation used up the click's user activation,
 * so browsers would block it.
 */
export const useUploadHashFocus = (
  boxRef: RefObject<HTMLElement | null>,
  inputRef: RefObject<HTMLInputElement | null>,
) => {
  useEffect(() => {
    if (window.location.hash !== `#${UPLOAD_BOX_ID}`) {
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    boxRef.current?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    inputRef.current?.focus({ preventScroll: true });
  }, [boxRef, inputRef]);
};

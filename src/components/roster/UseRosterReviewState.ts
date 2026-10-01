'use client';

import { useMemo, useRef, useState } from 'react';

import {
  collectRosterBlockers,
  findBlockerDate,
  isLegendBlocker,
  listIncludedEntries,
} from '@/client/TeamRosterGrid';
import { useMediaQuery } from '@/components/UseMediaQuery';
import { listUnresolvedCodes } from '@/domain/DefinedCodeResolver';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';

/** Wide table from 768px; below it the person list → month editor (TeamShareSpec §8). */
export const WIDE_ROSTER_QUERY = '(min-width: 768px)';

export type RosterCell = {
  rowId: string;
  date: string;
};

const focusLater = (find: () => HTMLElement | null) => {
  window.requestAnimationFrame(() => {
    const target = find();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  });
};

/** View state of the review phase: selection, open person (mobile), legend editor, time confirmation. */
export const useRosterReviewState = (view: TeamRosterResponse) => {
  const isWide = useMediaQuery(WIDE_ROSTER_QUERY);
  const [selected, setSelected] = useState<RosterCell | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([]);
  const legendRef = useRef<HTMLElement | null>(null);
  const legendRowsRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);
  const blockers = useMemo(() => collectRosterBlockers(view.rows, view.definitions), [view]);
  const includedEntries = useMemo(() => listIncludedEntries(view.rows), [view]);
  // Excluded rows still count as using a code (deleting it would leave them pointing at nothing).
  const allEntries = useMemo(() => view.rows.flatMap((row) => row.entries), [view]);
  const undefinedCodes = useMemo(
    () => listUnresolvedCodes(includedEntries, view.definitions),
    [includedEntries, view.definitions],
  );
  // Times read from a photo must be confirmed again after any legend change (same rule as personal drafts).
  const requiresTimeConfirmation = view.rows.some((row) => row.sourceCells.length > 0);
  const definitionsKey = useMemo(() => JSON.stringify(view.definitions), [view.definitions]);
  const isTimeConfirmed = confirmedKey === definitionsKey;
  const unmatched = view.unmatchedPreviousRows.filter((row) => !dismissedKeys.includes(row.rowKey));

  const handleSelectCell = (cell: RosterCell) => setSelected(cell);

  const handleOpenRow = (rowId: string) => {
    const row = view.rows.find((item) => item.id === rowId);
    const firstReview = row?.entries.find((entry) => entry.code === null || !entry.confirmed);

    setOpenRowId(rowId);
    setSelected({ rowId, date: firstReview?.date ?? row?.entries[0]?.date ?? '' });
    focusLater(() => document.querySelector<HTMLElement>('[data-person-heading]'));
  };

  /** Back to the list, focus on the person just edited. */
  const handleCloseRow = () => {
    const rowId = openRowId;

    setOpenRowId(null);

    if (rowId) {
      focusLater(() => document.querySelector<HTMLElement>(`[data-row-button="${CSS.escape(rowId)}"]`));
    }
  };

  const handleSelectBlocker = (rowId: string, blocker: PublishBlocker) => {
    const row = view.rows.find((item) => item.id === rowId);
    const date = row ? findBlockerDate(blocker, row.entries) : null;

    if (isLegendBlocker(blocker)) {
      const code = 'codes' in blocker ? (blocker.codes[0] ?? null) : null;

      setIsLegendOpen(true);
      focusLater(
        () =>
          (code
            ? legendRowsRef.current?.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"]`)
            : null) ?? legendRef.current,
      );

      return;
    }

    if (!date) {
      return;
    }

    setSelected({ rowId, date });

    if (isWide) {
      focusLater(() =>
        document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${rowId}:${date}`)}"]`),
      );
    } else {
      setOpenRowId(rowId);
      focusLater(() => document.querySelector<HTMLElement>('[data-roster-editor]'));
    }
  };

  const handleSelectUndefinedCodes = () => {
    const code = undefinedCodes[0];

    setIsLegendOpen(true);
    focusLater(
      () =>
        (code
          ? legendRowsRef.current?.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"]`)
          : null) ?? legendRef.current,
    );
  };

  const handleSelectTimeConfirmation = () => {
    setIsLegendOpen(true);
    focusLater(() => confirmRef.current);
  };

  return {
    isWide,
    selected,
    openRowId,
    isLegendOpen,
    isTimeConfirmed,
    requiresTimeConfirmation,
    blockers,
    allEntries,
    undefinedCodes,
    unmatched,
    legendRef,
    legendRowsRef,
    confirmRef,
    setOpenRowId,
    setIsLegendOpen,
    setTimeConfirmed: (isConfirmed: boolean) => setConfirmedKey(isConfirmed ? definitionsKey : null),
    handleDismissUnmatched: (rowKey: string) => setDismissedKeys((keys) => [...keys, rowKey]),
    handleSelectCell,
    handleOpenRow,
    handleCloseRow,
    handleSelectBlocker,
    handleSelectUndefinedCodes,
    handleSelectTimeConfirmation,
  };
};

export type RosterReviewState = ReturnType<typeof useRosterReviewState>;

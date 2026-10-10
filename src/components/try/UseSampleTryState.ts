'use client';

import { useEffect, useRef, useState } from 'react';

import { sendClientEvent } from '@/client/ClientAnalytics';
import {
  createInitialSampleTryState,
  goBack,
  goNext,
  restoreStep,
  type SampleTryState,
  selectCode,
  selectDate,
  selectPerson,
} from '@/client/SampleTryFlow';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { SampleTryStep } from '@/domain/enums/SampleTryStep';

/** Key in `history.state` (Next keeps its own keys next to it) recording which trial step an entry shows. */
const HISTORY_STEP_KEY = 'offnalSampleTryStep';

const STEP_VALUES = new Set<string>(Object.values(SampleTryStep));

const readHistoryStep = (state: unknown): SampleTryStep | null => {
  if (typeof state !== 'object' || state === null) {
    return null;
  }

  const value = (state as Record<string, unknown>)[HISTORY_STEP_KEY];

  return typeof value === 'string' && STEP_VALUES.has(value) ? (value as SampleTryStep) : null;
};

const pushHistoryStep = (step: SampleTryStep) => {
  window.history.pushState({ [HISTORY_STEP_KEY]: step }, '');
};

/**
 * Sample trial (Spec §26.3): client-only steps with browser history (each step forward adds an entry on the
 * same /try address, so the phone's back gesture and the on-screen back button both return one step; a reload
 * starts over) and the trial's three usage events.
 */
export const useSampleTryState = () => {
  const [state, setState] = useState<SampleTryState>(createInitialSampleTryState);
  const hasStartedRef = useRef(false);
  const hasCompletedRef = useRef(false);
  const hasMovedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      sendClientEvent({ event: AnalyticsEvent.SAMPLE_STARTED });
    }
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const step = readHistoryStep(event.state) ?? SampleTryStep.READ;

      hasMovedRef.current = true;

      setState((current) => restoreStep(current, step));
    };

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (state.step === SampleTryStep.DONE && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      sendClientEvent({ event: AnalyticsEvent.SAMPLE_COMPLETED });
    }
  }, [state.step]);

  // A new step starts at the top with focus on its title (not on first render: the page just loaded).
  useEffect(() => {
    if (!hasMovedRef.current) {
      return;
    }

    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [state.step]);

  const handleNext = () => {
    const next = goNext(state);

    if (next.step === state.step) {
      setState(next);

      return;
    }

    hasMovedRef.current = true;
    pushHistoryStep(next.step);
    setState(next);
  };

  /** Back through history when this step was pushed by the trial; otherwise (after a reload) just go back. */
  const handleBack = () => {
    hasMovedRef.current = true;

    if (readHistoryStep(window.history.state) === state.step) {
      window.history.back();

      return;
    }

    setState(goBack);
  };

  const handleSelectPerson = (rowId: string) => setState((current) => selectPerson(current, rowId));

  const handleSelectDate = (date: string) => setState((current) => selectDate(current, date));

  const handleSelectCode = (code: string) => setState((current) => selectCode(current, code));

  const handleCtaClick = () => {
    sendClientEvent({ event: AnalyticsEvent.SAMPLE_CTA_CLICKED });
  };

  return {
    state,
    headingRef,
    handleNext,
    handleBack,
    handleSelectPerson,
    handleSelectDate,
    handleSelectCode,
    handleCtaClick,
  };
};

export type SampleTryScreenState = ReturnType<typeof useSampleTryState>;

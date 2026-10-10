'use client';

import { useEffect, useRef, useState } from 'react';

import { sendClientEvent } from '@/client/ClientAnalytics';
import { SAMPLE_TRY_PATH } from '@/client/SampleTryCopy';
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
import {
  buildPushedTrialHistoryState,
  buildTrialHistoryState,
  createTrialMountId,
  readTrialHistoryStep,
} from '@/client/SampleTryHistory';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { SampleTryStep } from '@/domain/enums/SampleTryStep';

/**
 * Sample trial (Spec §26.3): client-only steps with browser history (each step forward adds an entry on the
 * same /try address, so the phone's back gesture and the on-screen back button both return one step; a reload
 * starts over) and the trial's three usage events. Entries of an earlier mount are skipped (see SampleTryHistory).
 */
export const useSampleTryState = () => {
  const [state, setState] = useState<SampleTryState>(createInitialSampleTryState);
  const hasStartedRef = useRef(false);
  const hasCompletedRef = useRef(false);
  const hasMovedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const mountIdRef = useRef<string | null>(null);

  // This mount starts at READ on the current entry, whatever an earlier mount left there.
  useEffect(() => {
    const mountId = createTrialMountId();

    mountIdRef.current = mountId;
    window.history.replaceState(
      buildTrialHistoryState(window.history.state, mountId, SampleTryStep.READ),
      '',
    );
  }, []);

  useEffect(() => {
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      sendClientEvent({ event: AnalyticsEvent.SAMPLE_STARTED });
    }
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // Leaving /try is the router's business.
      if (window.location.pathname !== SAMPLE_TRY_PATH || !mountIdRef.current) {
        return;
      }

      const step = readTrialHistoryStep(event.state, mountIdRef.current);

      hasMovedRef.current = true;

      if (step === null) {
        // A stale entry from an earlier visit: keep going back (towards leaving), at READ meanwhile.
        setState((current) => restoreStep(current, SampleTryStep.READ));
        window.history.back();

        return;
      }

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

    if (mountIdRef.current) {
      window.history.pushState(buildPushedTrialHistoryState(mountIdRef.current, next.step), '');
    }

    setState(next);
  };

  /** Back through history when this step was pushed by the trial; otherwise (after a reload) just go back. */
  const handleBack = () => {
    hasMovedRef.current = true;

    const mountId = mountIdRef.current;

    if (mountId && readTrialHistoryStep(window.history.state, mountId) === state.step) {
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

'use client';

import { useSyncExternalStore } from 'react';

import { msUntilNextSeoulMidnight, todayInSeoul } from '@/domain/YearMonth';

/** Fires a little after midnight so the new day is already visible to `todayInSeoul` despite timer jitter. */
const MIDNIGHT_SLACK_MS = 1000;

/** Window events after which a sleeping device or a bfcache restore may have stalled the midnight timer. */
const WAKE_WINDOW_EVENTS = ['focus', 'pageshow'] as const;

/**
 * One timeout per subscription, re-armed at every Seoul midnight. Waking up (tab visible again, focus,
 * bfcache restore) re-reads the clock and re-arms, since setTimeout does not run while the device sleeps.
 */
export const subscribeToSeoulDay = (onChange: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        onChange();
        arm();
      },
      msUntilNextSeoulMidnight(new Date()) + MIDNIGHT_SLACK_MS,
    );
  };

  const handleWake = () => {
    if (document.visibilityState === 'hidden') {
      return;
    }

    onChange();
    arm();
  };

  arm();
  document.addEventListener('visibilitychange', handleWake);
  WAKE_WINDOW_EVENTS.forEach((type) => window.addEventListener(type, handleWake));

  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', handleWake);
    WAKE_WINDOW_EVENTS.forEach((type) => window.removeEventListener(type, handleWake));
  };
};

export const getTodaySnapshot = (): string | null => todayInSeoul(new Date());

/** The server (and the hydrating render) has no "today": avoids a hydration mismatch across timezones/midnight. */
const getServerSnapshot = (): string | null => null;

/** Today's date (YYYY-MM-DD) in Seoul once mounted in the browser; `null` during server render and hydration. */
export const useTodayInSeoul = (): string | null =>
  useSyncExternalStore(subscribeToSeoulDay, getTodaySnapshot, getServerSnapshot);

'use client';

import { useSyncExternalStore } from 'react';

import { msUntilNextSeoulMidnight, todayInSeoul } from '@/domain/YearMonth';

/** Fires a little after midnight so the new day is already visible to `todayInSeoul` despite timer jitter. */
const MIDNIGHT_SLACK_MS = 1000;

/** One timeout per subscription, re-armed at every Seoul midnight and cleared on unmount. */
const subscribeToSeoulMidnight = (onChange: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    timer = setTimeout(
      () => {
        onChange();
        arm();
      },
      msUntilNextSeoulMidnight(new Date()) + MIDNIGHT_SLACK_MS,
    );
  };

  arm();

  return () => {
    clearTimeout(timer);
  };
};

const getTodaySnapshot = (): string | null => todayInSeoul(new Date());

/** The server (and the hydrating render) has no "today": avoids a hydration mismatch across timezones/midnight. */
const getServerSnapshot = (): string | null => null;

/** Today's date (YYYY-MM-DD) in Seoul once mounted in the browser; `null` during server render and hydration. */
export const useTodayInSeoul = (): string | null =>
  useSyncExternalStore(subscribeToSeoulMidnight, getTodaySnapshot, getServerSnapshot);

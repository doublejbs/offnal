'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  getIcsPlatformGuide,
  getInAppBrowserNotice,
  PAGE_URL_COPIED_MESSAGE,
  PAGE_URL_COPY_FAILED_MESSAGE,
} from '@/client/IcsCopy';
import { readBrowserPlatformInfo } from '@/client/PlatformDetect';
import { getBrowserShareEnvironment } from '@/client/ShareOrDownload';
import { type ClientPlatform } from '@/domain/enums/ClientPlatform';
import { type InAppBrowser } from '@/domain/enums/InAppBrowser';

/** A navigation cannot report completion: keep the double-tap guard for this long instead. */
const NAVIGATION_GUARD_MS = 2000;

const subscribeNever = (): (() => void) => () => undefined;

const readPlatform = (): ClientPlatform | null => readBrowserPlatformInfo()?.platform ?? null;

const readServerPlatform = (): ClientPlatform | null => null;

/**
 * Platform-aware delivery of the ICS file (Spec §19). The platform is read after hydration only
 * (null on the server and the first render), so the first render always shows the generic copy.
 */
export const useIcsOpenSupport = () => {
  const platform = useSyncExternalStore(subscribeNever, readPlatform, readServerPlatform);
  const [inAppNotice, setInAppNotice] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const showInAppNotice = (browser: InAppBrowser) => {
    setInAppNotice(getInAppBrowserNotice(browser));
  };

  /** A navigation cannot report completion: `onSettled` releases the double-tap guard later. */
  const holdNavigationGuard = (onSettled: () => void) => {
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onSettled();
    }, NAVIGATION_GUARD_MS);
  };

  const handleCopyPageUrl = async () => {
    const url = window.location.href;
    const { writeClipboard } = getBrowserShareEnvironment();

    setCopyMessage(null);
    setFallbackUrl(null);

    try {
      if (!writeClipboard) {
        throw new Error('clipboard unavailable');
      }

      await writeClipboard(url);
      setCopyMessage(PAGE_URL_COPIED_MESSAGE);
    } catch {
      setCopyMessage(PAGE_URL_COPY_FAILED_MESSAGE);
      setFallbackUrl(url);
    }
  };

  const resetNotice = () => {
    setInAppNotice(null);
    setCopyMessage(null);
    setFallbackUrl(null);
  };

  return {
    platformGuide: getIcsPlatformGuide(platform),
    inAppNotice,
    copyMessage,
    fallbackUrl,
    showInAppNotice,
    holdNavigationGuard,
    handleCopyPageUrl,
    resetNotice,
  };
};

export type IcsOpenSupport = ReturnType<typeof useIcsOpenSupport>;

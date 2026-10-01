import { ClientPlatform } from '@/domain/enums/ClientPlatform';
import { InAppBrowser } from '@/domain/enums/InAppBrowser';

/** Platform and in-app browser of the current page, detected on the client only. */
export type PlatformInfo = {
  platform: ClientPlatform;
  inAppBrowser: InAppBrowser;
};

const IOS_DEVICE_PATTERN = /iPhone|iPad|iPod/;
const IOS_PLATFORM_PATTERN = /^(iPhone|iPad|iPod)/;
const MAC_PLATFORM = 'MacIntel';
const ANDROID_PATTERN = /Android/i;
const ANDROID_WEBVIEW_PATTERN = /; wv\)/;
const SAFARI_TOKEN_PATTERN = /Safari\//;

/** Checked in order: the first matching pattern names the in-app browser. */
const IN_APP_PATTERNS: [InAppBrowser, RegExp][] = [
  [InAppBrowser.KAKAOTALK, /KAKAOTALK/i],
  [InAppBrowser.NAVER, /NAVER\(inapp/i],
  [InAppBrowser.INSTAGRAM, /Instagram/],
  [InAppBrowser.FACEBOOK, /FBAN\/|FBAV\/|FB_IAB\//],
  [InAppBrowser.LINE, /\bLine\//],
];

/**
 * iPhone/iPod/iPad, including iPadOS which sends a desktop "Macintosh" UA: there only touch
 * support (maxTouchPoints > 1) tells it apart from a Mac.
 */
export const detectIos = (userAgent: string, maxTouchPoints = 0, platform = ''): boolean => {
  if (IOS_DEVICE_PATTERN.test(userAgent) || IOS_PLATFORM_PATTERN.test(platform)) {
    return true;
  }

  const looksLikeMac = userAgent.includes('Macintosh') || platform === MAC_PLATFORM;

  return looksLikeMac && maxTouchPoints > 1;
};

export const detectAndroid = (userAgent: string): boolean => ANDROID_PATTERN.test(userAgent);

/**
 * Known in-app browsers by their UA token; otherwise an Android WebView (`; wv)`) or an iOS
 * WKWebView (no `Safari/` token, which every regular iOS browser sends) is OTHER_WEBVIEW.
 */
export const detectInAppBrowser = (userAgent: string): InAppBrowser => {
  const known = IN_APP_PATTERNS.find(([, pattern]) => pattern.test(userAgent));

  if (known) {
    return known[0];
  }

  if (detectAndroid(userAgent) && ANDROID_WEBVIEW_PATTERN.test(userAgent)) {
    return InAppBrowser.OTHER_WEBVIEW;
  }

  if (IOS_DEVICE_PATTERN.test(userAgent) && !SAFARI_TOKEN_PATTERN.test(userAgent)) {
    return InAppBrowser.OTHER_WEBVIEW;
  }

  return InAppBrowser.NONE;
};

export const detectPlatformInfo = (userAgent: string, maxTouchPoints = 0, platform = ''): PlatformInfo => {
  const inAppBrowser = detectInAppBrowser(userAgent);

  if (detectIos(userAgent, maxTouchPoints, platform)) {
    return { platform: ClientPlatform.IOS, inAppBrowser };
  }

  if (detectAndroid(userAgent)) {
    return { platform: ClientPlatform.ANDROID, inAppBrowser };
  }

  return { platform: ClientPlatform.DESKTOP, inAppBrowser };
};

/** Reads the current browser; null during SSR (callers fall back to the generic behaviour). */
export const readBrowserPlatformInfo = (): PlatformInfo | null => {
  if (typeof navigator === 'undefined') {
    return null;
  }

  return detectPlatformInfo(navigator.userAgent, navigator.maxTouchPoints, navigator.platform);
};

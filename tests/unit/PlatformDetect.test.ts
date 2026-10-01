import { describe, expect, it } from 'vitest';

import {
  detectAndroid,
  detectInAppBrowser,
  detectIos,
  detectIosThirdPartyBrowser,
  detectPlatformInfo,
} from '@/client/PlatformDetect';
import { ClientPlatform } from '@/domain/enums/ClientPlatform';
import { InAppBrowser } from '@/domain/enums/InAppBrowser';

type UaSample = {
  name: string;
  ua: string;
  maxTouchPoints?: number;
  platform?: string;
  ios: boolean;
  android: boolean;
  inApp: InAppBrowser;
};

const SAMPLES: UaSample[] = [
  {
    name: 'Safari iOS 17 (iPhone)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    platform: 'iPhone',
    ios: true,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Safari iOS 18 (iPhone)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    ios: true,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Chrome iOS (CriOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
    ios: true,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Firefox iOS (FxiOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
    ios: true,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'iPad (legacy iPad UA)',
    ua: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    ios: true,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'iPod touch',
    ua: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
    ios: true,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'iPadOS Safari (desktop UA + touch)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    maxTouchPoints: 5,
    platform: 'MacIntel',
    ios: true,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'KakaoTalk in-app (iOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.6.5',
    ios: true,
    android: false,
    inApp: InAppBrowser.KAKAOTALK,
  },
  {
    name: 'KakaoTalk in-app (Android)',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36;KAKAOTALK 2410530',
    ios: false,
    android: true,
    inApp: InAppBrowser.KAKAOTALK,
  },
  {
    name: 'NAVER app (iOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.6.0; 15PRO)',
    ios: true,
    android: false,
    inApp: InAppBrowser.NAVER,
  },
  {
    name: 'NAVER app (Android)',
    ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991N Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.5.10)',
    ios: false,
    android: true,
    inApp: InAppBrowser.NAVER,
  },
  {
    name: 'Instagram (iOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,3; iOS 17_5; ko_KR; ko; scale=3.00; 1290x2796; 609139398)',
    ios: true,
    android: false,
    inApp: InAppBrowser.INSTAGRAM,
  },
  {
    name: 'Facebook (iOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/ko_KR;FBOP/5]',
    ios: true,
    android: false,
    inApp: InAppBrowser.FACEBOOK,
  },
  {
    name: 'LINE (iOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.8.0',
    ios: true,
    android: false,
    inApp: InAppBrowser.LINE,
  },
  {
    name: 'Unknown iOS WKWebView (no Safari token)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    ios: true,
    android: false,
    inApp: InAppBrowser.OTHER_WEBVIEW,
  },
  {
    name: 'Unknown iPadOS WKWebView (desktop UA + touch, no Safari token)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    maxTouchPoints: 5,
    platform: 'MacIntel',
    ios: true,
    android: false,
    inApp: InAppBrowser.OTHER_WEBVIEW,
  },
  {
    name: 'macOS app WKWebView (no touch, no Safari token)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    maxTouchPoints: 0,
    platform: 'MacIntel',
    ios: false,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Unknown Android WebView (wv)',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36',
    ios: false,
    android: true,
    inApp: InAppBrowser.OTHER_WEBVIEW,
  },
  {
    name: 'Android Chrome',
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    maxTouchPoints: 5,
    platform: 'Linux armv81',
    ios: false,
    android: true,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Samsung Internet',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    ios: false,
    android: true,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Desktop Chrome (macOS)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    maxTouchPoints: 0,
    platform: 'MacIntel',
    ios: false,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Desktop Safari (macOS)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    maxTouchPoints: 0,
    platform: 'MacIntel',
    ios: false,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Desktop Chrome (Windows)',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    maxTouchPoints: 10,
    platform: 'Win32',
    ios: false,
    android: false,
    inApp: InAppBrowser.NONE,
  },
  {
    name: 'Playwright headless Chromium',
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.6723.31 Safari/537.36',
    ios: false,
    android: false,
    inApp: InAppBrowser.NONE,
  },
];

describe('PlatformDetect', () => {
  it.each(SAMPLES)('detects $name', (sample) => {
    expect(detectIos(sample.ua, sample.maxTouchPoints, sample.platform)).toBe(sample.ios);
    expect(detectAndroid(sample.ua)).toBe(sample.android);
    expect(detectInAppBrowser(sample.ua, sample.maxTouchPoints, sample.platform)).toBe(sample.inApp);
  });

  it('does not treat a Mac without touch support as iPadOS', () => {
    const macSafari = SAMPLES.find((sample) => sample.name === 'Desktop Safari (macOS)')?.ua ?? '';

    expect(detectIos(macSafari)).toBe(false);
    expect(detectIos(macSafari, 1)).toBe(false);
    expect(detectIos(macSafari, 2)).toBe(true);
  });

  it('detects iOS from navigator.platform when the UA hides it', () => {
    expect(detectIos('Mozilla/5.0', 0, 'iPhone')).toBe(true);
    expect(detectIos('Mozilla/5.0', 5, 'MacIntel')).toBe(true);
    expect(detectIos('Mozilla/5.0', 0, 'MacIntel')).toBe(false);
  });

  it('tells third-party iOS browsers apart from Safari', () => {
    const uaOf = (name: string): string => SAMPLES.find((sample) => sample.name === name)?.ua ?? '';

    expect(detectIosThirdPartyBrowser(uaOf('Chrome iOS (CriOS)'))).toBe(true);
    expect(detectIosThirdPartyBrowser(uaOf('Firefox iOS (FxiOS)'))).toBe(true);
    expect(
      detectIosThirdPartyBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.2592.56 Mobile/15E148 Safari/605.1.15',
      ),
    ).toBe(true);
    expect(detectIosThirdPartyBrowser(uaOf('Safari iOS 18 (iPhone)'))).toBe(false);
    expect(detectIosThirdPartyBrowser(uaOf('iPadOS Safari (desktop UA + touch)'))).toBe(false);
  });

  it('summarises the platform and in-app browser', () => {
    expect(detectPlatformInfo(SAMPLES[0]?.ua ?? '', 5, 'iPhone')).toEqual({
      platform: ClientPlatform.IOS,
      inAppBrowser: InAppBrowser.NONE,
      isIosThirdPartyBrowser: false,
    });
    expect(detectPlatformInfo(SAMPLES[8]?.ua ?? '')).toEqual({
      platform: ClientPlatform.ANDROID,
      inAppBrowser: InAppBrowser.KAKAOTALK,
      isIosThirdPartyBrowser: false,
    });
    expect(
      detectPlatformInfo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36'),
    ).toEqual({
      platform: ClientPlatform.DESKTOP,
      inAppBrowser: InAppBrowser.NONE,
      isIosThirdPartyBrowser: false,
    });
  });
});

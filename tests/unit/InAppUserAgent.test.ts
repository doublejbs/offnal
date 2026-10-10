import { describe, expect, it } from 'vitest';

import { isSocialInAppUserAgent } from '@/server/analytics/InAppUserAgent';

const INSTAGRAM_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.29.87 (iPhone15,3; iOS 18_5; ko_KR; ko; scale=3.00; 1290x2796; 761216781)';
const INSTAGRAM_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 Instagram 352.0.0.38.100 Android (34/14; 480dpi; 1080x2115; samsung; SM-S918N; dm3q; qcom; ko_KR; 646182285)';
const FACEBOOK_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/482.0.0.40.106;FBBV/650000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBLC/ko_KR]';
const FACEBOOK_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/476.0.0.49.74;]';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const KAKAOTALK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.6.0';

describe('isSocialInAppUserAgent (Spec §26.5 inApp)', () => {
  it('detects the Instagram and Facebook in-app browsers', () => {
    expect(isSocialInAppUserAgent(INSTAGRAM_IOS)).toBe(true);
    expect(isSocialInAppUserAgent(INSTAGRAM_ANDROID)).toBe(true);
    expect(isSocialInAppUserAgent(FACEBOOK_IOS)).toBe(true);
    expect(isSocialInAppUserAgent(FACEBOOK_ANDROID)).toBe(true);
  });

  it('treats regular browsers, other in-app browsers and a missing UA as not in-app', () => {
    expect(isSocialInAppUserAgent(SAFARI_IOS)).toBe(false);
    expect(isSocialInAppUserAgent(CHROME_ANDROID)).toBe(false);
    expect(isSocialInAppUserAgent(KAKAOTALK)).toBe(false);
    expect(isSocialInAppUserAgent('')).toBe(false);
    expect(isSocialInAppUserAgent(null)).toBe(false);
  });

  it('does not match look-alike words', () => {
    expect(isSocialInAppUserAgent('Mozilla/5.0 instagrammer-bot FBANANA')).toBe(false);
  });
});

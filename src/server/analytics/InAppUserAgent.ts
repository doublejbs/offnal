/**
 * Instagram and Facebook in-app browsers by their User-Agent tokens (`Instagram 389.0…`, `[FBAN/…;FBAV/…]`,
 * `[FB_IAB/…]`). Only this boolean is stored (`inApp`, Spec §26.5), never the User-Agent itself.
 */
const SOCIAL_IN_APP_PATTERN = /\bInstagram [\d.]+|\bFBAN\/|\bFBAV\/|\bFB_IAB\//;

export const isSocialInAppUserAgent = (userAgent: string | null | undefined): boolean =>
  typeof userAgent === 'string' && SOCIAL_IN_APP_PATTERN.test(userAgent);

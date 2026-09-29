import { getAppConfig } from '@/server/config/AppConfig';
import { decryptText, encryptText, generateToken, hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type CalendarRow } from '@/server/db/Schema';
import { buildAppUrl } from '@/server/http/RouteHelpers';

const SHARE_TOKEN_INFO = 'share-token';
/** 32 random bytes in base64url. */
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type IssuedShareToken = {
  token: string;
  /** Lookup key (sha256 hex). */
  hash: string;
  /** AES-256-GCM ciphertext so the owner can see the link again. */
  ciphertext: string;
};

export const isShareTokenFormat = (token: string): boolean => SHARE_TOKEN_PATTERN.test(token);

export const hashShareToken = (token: string): string => hashSha256Hex(token);

export const issueShareToken = (): IssuedShareToken => {
  const token = generateToken();

  return {
    token,
    hash: hashShareToken(token),
    ciphertext: encryptText(token, getAppConfig().appSecret, SHARE_TOKEN_INFO),
  };
};

export const buildShareUrl = (token: string): string => buildAppUrl(`/s/${token}`).toString();

/** Owner-facing share URL, or null when sharing is off (or the ciphertext no longer decrypts). */
export const resolveShareUrl = (calendar: CalendarRow | null): string | null => {
  if (!calendar?.shareEnabled || !calendar.shareTokenCiphertext) {
    return null;
  }

  try {
    return buildShareUrl(
      decryptText(calendar.shareTokenCiphertext, getAppConfig().appSecret, SHARE_TOKEN_INFO),
    );
  } catch {
    return null;
  }
};

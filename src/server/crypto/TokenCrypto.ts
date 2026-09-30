import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const TOKEN_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const CIPHER = 'aes-256-gcm';
const PAYLOAD_VERSION = 'v1';
const HKDF_SALT = 'offnal';
const DEFAULT_KEY_INFO = 'offnal-token-encryption';

export const generateToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

export const hashSha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const deriveKey = (secret: string, info: string = DEFAULT_KEY_INFO): Buffer => {
  if (secret.length === 0) {
    throw new Error('Secret must not be empty');
  }

  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, info, KEY_BYTES));
};

/** Encrypts text with AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export const encryptText = (plainText: string, secret: string, info?: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, deriveKey(secret, info), iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PAYLOAD_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

export const decryptText = (payload: string, secret: string, info?: string): string => {
  const [version, ivPart, tagPart, bodyPart, ...rest] = payload.split('.');

  if (version !== PAYLOAD_VERSION || !ivPart || !tagPart || bodyPart === undefined || rest.length > 0) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
    throw new Error('Invalid encrypted payload');
  }

  const decipher = createDecipheriv(CIPHER, deriveKey(secret, info), iv, { authTagLength: AUTH_TAG_BYTES });

  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(Buffer.from(bodyPart, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
};

/** Constant-time comparison: both sides are hashed to equal-length digests first. */
export const isEqualConstantTime = (left: string, right: string): boolean => {
  const leftHash = createHash('sha256').update(left, 'utf8').digest();
  const rightHash = createHash('sha256').update(right, 'utf8').digest();

  return timingSafeEqual(leftHash, rightHash);
};

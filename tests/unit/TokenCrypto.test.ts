import { describe, expect, it } from 'vitest';

import {
  decryptText,
  encryptText,
  generateToken,
  hashSha256Hex,
  isEqualConstantTime,
} from '@/server/crypto/TokenCrypto';

const SECRET = 'unit-test-secret-unit-test-secret-0123';

const flipFirstByte = (part: string): string => {
  const bytes = Buffer.from(part, 'base64url');

  bytes[0] = (bytes[0] ?? 0) ^ 0xff;

  return bytes.toString('base64url');
};

describe('TokenCrypto', () => {
  it('generates 32-byte base64url tokens', () => {
    const token = generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateToken()).not.toBe(token);
  });

  it('hashes with sha256 hex', () => {
    expect(hashSha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('round-trips AES-256-GCM encryption', () => {
    const token = generateToken();
    const encrypted = encryptText(token, SECRET);

    expect(encrypted).not.toContain(token);
    expect(encryptText(token, SECRET)).not.toBe(encrypted);
    expect(decryptText(encrypted, SECRET)).toBe(token);
  });

  it('fails to decrypt with the wrong secret or tampered data', () => {
    const encrypted = encryptText('hello', SECRET);
    const [version, iv, tag, body] = encrypted.split('.');
    const tampered = [version, iv, tag, flipFirstByte(body!)].join('.');

    expect(() => decryptText(encrypted, `${SECRET}-other`)).toThrow();
    expect(() => decryptText(tampered, SECRET)).toThrow();
    expect(() => decryptText('garbage', SECRET)).toThrow();
  });

  it('rejects a truncated auth tag or a wrong-length iv', () => {
    const encrypted = encryptText('hello', SECRET);
    const [version, iv, tag, body] = encrypted.split('.');
    const shortTag = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    const shortIv = Buffer.from(iv!, 'base64url').subarray(0, 8).toString('base64url');

    expect(() => decryptText([version, iv, shortTag, body].join('.'), SECRET)).toThrow(
      'Invalid encrypted payload',
    );
    expect(() => decryptText([version, shortIv, tag, body].join('.'), SECRET)).toThrow(
      'Invalid encrypted payload',
    );
  });

  it('compares strings in constant time', () => {
    expect(isEqualConstantTime('abc', 'abc')).toBe(true);
    expect(isEqualConstantTime('abc', 'abd')).toBe(false);
    expect(isEqualConstantTime('abc', 'abcd')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { decryptText, encryptText, randomToken, safeEqual, sha256Hex } from '@/server/crypto/TokenCrypto';

const SECRET = 'unit-test-secret-unit-test-secret-0123';

describe('TokenCrypto', () => {
  it('generates 32-byte base64url tokens', () => {
    const token = randomToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(randomToken()).not.toBe(token);
  });

  it('hashes with sha256 hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('round-trips AES-256-GCM encryption', () => {
    const token = randomToken();
    const encrypted = encryptText(token, SECRET);

    expect(encrypted).not.toContain(token);
    expect(encryptText(token, SECRET)).not.toBe(encrypted);
    expect(decryptText(encrypted, SECRET)).toBe(token);
  });

  it('fails to decrypt with the wrong secret or tampered data', () => {
    const encrypted = encryptText('hello', SECRET);
    const parts = encrypted.split('.');
    const body = Buffer.from(parts[3]!, 'base64url');

    body[0] = (body[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], body.toString('base64url')].join('.');

    expect(() => decryptText(encrypted, `${SECRET}-other`)).toThrow();
    expect(() => decryptText(tampered, SECRET)).toThrow();
    expect(() => decryptText('garbage', SECRET)).toThrow();
  });

  it('compares strings in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

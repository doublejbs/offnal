import { describe, expect, it } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { detectImageSignature } from '@/domain/ImageSignature';

const bytesOf = (...values: (number | string)[]): Uint8Array => {
  const out: number[] = [];

  for (const value of values) {
    if (typeof value === 'string') {
      out.push(...Array.from(value, (char) => char.charCodeAt(0)));
    } else {
      out.push(value);
    }
  }

  return new Uint8Array([...out, ...new Array<number>(16).fill(0)]);
};

describe('ImageSignature', () => {
  it('detects JPEG', () => {
    expect(detectImageSignature(bytesOf(0xff, 0xd8, 0xff, 0xe0))).toBe(ImageMimeType.JPEG);
  });

  it('detects PNG', () => {
    expect(detectImageSignature(bytesOf(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe(ImageMimeType.PNG);
  });

  it('detects WebP', () => {
    expect(detectImageSignature(bytesOf('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe(ImageMimeType.WEBP);
  });

  it('detects HEIC brands', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'hevc']) {
      expect(detectImageSignature(bytesOf(0, 0, 0, 0x18, 'ftyp', brand))).toBe(ImageMimeType.HEIC);
    }
  });

  it('rejects unknown or short data', () => {
    expect(detectImageSignature(new Uint8Array([]))).toBeNull();
    expect(detectImageSignature(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImageSignature(bytesOf('GIF89a'))).toBeNull();
    expect(detectImageSignature(bytesOf('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull();
    expect(detectImageSignature(bytesOf(0, 0, 0, 0x18, 'ftyp', 'avif'))).toBeNull();
    expect(detectImageSignature(bytesOf('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });
});

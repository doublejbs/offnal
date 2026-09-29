import { ImageMimeType } from '@/domain/enums/ImageMimeType';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

const matchesBytes = (bytes: Uint8Array, offset: number, expected: number[]): boolean =>
  bytes.length >= offset + expected.length &&
  expected.every((value, index) => bytes[offset + index] === value);

const readAscii = (bytes: Uint8Array, offset: number, length: number): string =>
  bytes.length < offset + length ? '' : String.fromCharCode(...bytes.subarray(offset, offset + length));

/** Detects the real image type from magic bytes, ignoring file names and client MIME types. */
export const detectImageSignature = (bytes: Uint8Array): ImageMimeType | null => {
  if (matchesBytes(bytes, 0, [0xff, 0xd8, 0xff])) {
    return ImageMimeType.JPEG;
  }

  if (matchesBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return ImageMimeType.PNG;
  }

  if (readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP') {
    return ImageMimeType.WEBP;
  }

  if (readAscii(bytes, 4, 4) === 'ftyp' && HEIC_BRANDS.has(readAscii(bytes, 8, 4))) {
    return ImageMimeType.HEIC;
  }

  return null;
};

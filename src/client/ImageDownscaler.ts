/** Long-edge limit sent to the server (keeps table text legible while staying small). */
export const MAX_LONG_EDGE = 2576;

const INITIAL_QUALITY = 0.85;
const MIN_QUALITY = 0.5;
const QUALITY_STEP = 0.1;
const RESIZE_STEP = 0.8;
const MIN_LONG_EDGE = 1024;
const MAX_RESIZE_ATTEMPTS = 6;

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class ImageDecodeError extends Error {
  constructor() {
    super('image decode failed');
    this.name = 'ImageDecodeError';
  }
}

export class ImageTooLargeError extends Error {
  constructor() {
    super('image could not be reduced below the upload limit');
    this.name = 'ImageTooLargeError';
  }
}

export type DownscaledImage = {
  blob: Blob;
  filename: string;
};

/** Pure: target size for a long edge limit (never upscales). */
export const fitWithinLongEdge = (
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } => {
  const longEdge = Math.max(width, height);

  if (longEdge <= maxLongEdge) {
    return { width, height };
  }

  const ratio = maxLongEdge / longEdge;

  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
};

const decode = async (file: Blob): Promise<ImageBitmap> => {
  if (typeof createImageBitmap !== 'function') {
    throw new ImageDecodeError();
  }

  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageDecodeError();
  }
};

const encodeJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

const drawScaled = (bitmap: ImageBitmap, longEdge: number): HTMLCanvasElement => {
  const size = fitWithinLongEdge(bitmap.width, bitmap.height, longEdge);
  const canvas = document.createElement('canvas');

  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new ImageDecodeError();
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(bitmap, 0, 0, size.width, size.height);

  return canvas;
};

const toJpegName = (name: string): string => `${name.replace(/\.[^.]+$/u, '') || 'photo'}.jpg`;

/**
 * Decodes (respecting EXIF orientation), shrinks the long edge to ≤ 2576px and re-encodes as JPEG,
 * lowering quality (then size) until the file is below `maxBytes`. Throws ImageDecodeError when the
 * browser cannot decode the file (e.g. HEIC on most non-Safari browsers).
 */
export const downscaleImage = async (file: File, maxBytes: number): Promise<DownscaledImage> => {
  const bitmap = await decode(file);
  let longEdge = Math.min(MAX_LONG_EDGE, Math.max(bitmap.width, bitmap.height));

  try {
    for (let attempt = 0; attempt < MAX_RESIZE_ATTEMPTS; attempt += 1) {
      const canvas = drawScaled(bitmap, longEdge);

      for (let quality = INITIAL_QUALITY; quality >= MIN_QUALITY - 1e-9; quality -= QUALITY_STEP) {
        const blob = await encodeJpeg(canvas, quality);

        if (blob && blob.size < maxBytes) {
          return { blob, filename: toJpegName(file.name) };
        }
      }

      if (longEdge <= MIN_LONG_EDGE) {
        break;
      }

      longEdge = Math.max(MIN_LONG_EDGE, Math.round(longEdge * RESIZE_STEP));
    }
  } finally {
    bitmap.close();
  }

  throw new ImageTooLargeError();
};

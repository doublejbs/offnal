/** Long-edge limit sent to the server (keeps table text legible while staying small). */
export const MAX_LONG_EDGE = 2576;

const QUALITIES = [0.85, 0.75, 0.65, 0.55];
const RESIZE_STEP = 0.8;
const MIN_LONG_EDGE = 1024;

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

export type Size = { width: number; height: number };

export type EncodingAttempt = Size & { quality: number };

/** Pure: target size for a long edge limit (never upscales). */
export const fitWithinLongEdge = (width: number, height: number, maxLongEdge: number): Size => {
  const longEdge = Math.max(width, height);

  if (longEdge <= maxLongEdge) {
    return { width, height };
  }

  const ratio = maxLongEdge / longEdge;

  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
};

/**
 * Pure: the ordered (size, quality) attempts — full quality first, then lower quality, then smaller
 * sizes down to a 1024px long edge (or the original size when it is already smaller).
 */
export const planEncodingAttempts = (width: number, height: number): EncodingAttempt[] => {
  const attempts: EncodingAttempt[] = [];
  const originalLongEdge = Math.max(width, height);
  let longEdge = Math.min(MAX_LONG_EDGE, originalLongEdge);

  for (;;) {
    const size = fitWithinLongEdge(width, height, longEdge);

    for (const quality of QUALITIES) {
      attempts.push({ ...size, quality });
    }

    if (longEdge <= MIN_LONG_EDGE) {
      return attempts;
    }

    longEdge = Math.max(MIN_LONG_EDGE, Math.round(longEdge * RESIZE_STEP));
  }
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

/** Uses the browser's high-quality resize when supported; falls back to scaling in drawImage. */
const resizeBitmap = async (bitmap: ImageBitmap, size: Size): Promise<ImageBitmap | null> => {
  if (size.width === bitmap.width && size.height === bitmap.height) {
    return null;
  }

  try {
    return await createImageBitmap(bitmap, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high',
    });
  } catch {
    return null;
  }
};

const encodeJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

const drawToCanvas = async (bitmap: ImageBitmap, size: Size): Promise<HTMLCanvasElement> => {
  const resized = await resizeBitmap(bitmap, size);
  const canvas = document.createElement('canvas');

  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');

  if (!context) {
    resized?.close();
    throw new ImageDecodeError();
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(resized ?? bitmap, 0, 0, size.width, size.height);
  resized?.close();

  return canvas;
};

/** Frees the canvas backing store right away (iOS Safari keeps a small total canvas budget). */
const releaseCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

const toJpegName = (name: string): string => `${name.replace(/\.[^.]+$/u, '') || 'photo'}.jpg`;

/**
 * Decodes (respecting EXIF orientation), shrinks the long edge to ≤ 2576px and re-encodes as JPEG,
 * lowering quality (then size) until the file is below `maxBytes`. Throws ImageDecodeError when the
 * browser cannot decode the file (e.g. HEIC on most non-Safari browsers).
 */
export const downscaleImage = async (file: File, maxBytes: number): Promise<DownscaledImage> => {
  const bitmap = await decode(file);
  let canvas: HTMLCanvasElement | null = null;
  let canvasSize = '';

  try {
    for (const attempt of planEncodingAttempts(bitmap.width, bitmap.height)) {
      const sizeKey = `${attempt.width}x${attempt.height}`;

      if (!canvas || canvasSize !== sizeKey) {
        if (canvas) {
          releaseCanvas(canvas);
        }

        canvas = await drawToCanvas(bitmap, attempt);
        canvasSize = sizeKey;
      }

      const blob = await encodeJpeg(canvas, attempt.quality);

      if (blob && blob.size < maxBytes) {
        return { blob, filename: toJpegName(file.name) };
      }
    }
  } finally {
    bitmap.close();

    if (canvas) {
      releaseCanvas(canvas);
    }
  }

  throw new ImageTooLargeError();
};

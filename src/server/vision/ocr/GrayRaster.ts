import { CHANNELS, LUMA_WEIGHTS, type PixelRect, type RawImage } from '@/server/vision/VisionGeometry';

/** 8-bit single-channel raster (luma, chroma or a 0/1 mask). */
export type GrayImage = { data: Uint8Array; width: number; height: number };

/** Luma and chroma (max − min of RGB) of the same pixels: lines are dark and gray, weekend bands colored. */
export type GrayChroma = { gray: GrayImage; chroma: GrayImage };

export type InkMaskOptions = {
  /** Half-size of the local mean window (pixels). */
  radius: number;
  /** A pixel is ink when darker than this share of the local mean. */
  darkShare: number;
  /** Pixels more colorful than this (0–255) are never line ink (blue/orange/green cell backgrounds). */
  maxChroma: number;
};

export const createGray = (width: number, height: number): GrayImage => ({
  data: new Uint8Array(width * height),
  width,
  height,
});

/** Box-averaged luma + chroma, downscaled by an integer factor (1 = full size). */
export const toGrayChroma = (image: RawImage, factor = 1): GrayChroma => {
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const gray = createGray(width, height);
  const chroma = createGray(width, height);
  const area = factor * factor;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let lumaSum = 0;
      let chromaSum = 0;

      for (let dy = 0; dy < factor; dy += 1) {
        let offset = ((y * factor + dy) * image.width + x * factor) * CHANNELS;

        for (let dx = 0; dx < factor; dx += 1) {
          const red = image.data[offset]!;
          const green = image.data[offset + 1]!;
          const blue = image.data[offset + 2]!;

          lumaSum += red * LUMA_WEIGHTS.red + green * LUMA_WEIGHTS.green + blue * LUMA_WEIGHTS.blue;
          chromaSum += Math.max(red, green, blue) - Math.min(red, green, blue);
          offset += CHANNELS;
        }
      }

      gray.data[y * width + x] = lumaSum / (area * LUMA_WEIGHTS.total);
      chroma.data[y * width + x] = chromaSum / area;
    }
  }

  return { gray, chroma };
};

/** Summed-area table with one zero row/column in front, for O(1) box means. */
const buildIntegral = (image: GrayImage): Float64Array => {
  const stride = image.width + 1;
  const integral = new Float64Array(stride * (image.height + 1));

  for (let y = 0; y < image.height; y += 1) {
    let rowSum = 0;

    for (let x = 0; x < image.width; x += 1) {
      rowSum += image.data[y * image.width + x]!;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + rowSum;
    }
  }

  return integral;
};

/** Mean gray of the (2·radius+1)² window around every pixel (clamped at the borders). */
export const computeLocalMeans = (image: GrayImage, radius: number): Float32Array => {
  const { width, height } = image;
  const integral = buildIntegral(image);
  const stride = width + 1;
  const means = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);

    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum =
        integral[bottom * stride + right]! -
        integral[top * stride + right]! -
        integral[bottom * stride + left]! +
        integral[top * stride + left]!;

      means[y * width + x] = sum / ((bottom - top) * (right - left));
    }
  }

  return means;
};

/**
 * Adaptive ink mask (1 = ink): darker than `darkShare` of the local mean and not colorful. Robust to uneven
 * lighting and to colored column backgrounds, which are uniform within the window.
 */
export const buildInkMask = (source: GrayChroma, options: InkMaskOptions): GrayImage => {
  const { gray, chroma } = source;
  const { width, height } = gray;
  const integral = buildIntegral(gray);
  const stride = width + 1;
  const mask = createGray(width, height);

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - options.radius);
    const bottom = Math.min(height, y + options.radius + 1);

    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;

      if (chroma.data[index]! > options.maxChroma) {
        continue;
      }

      const left = Math.max(0, x - options.radius);
      const right = Math.min(width, x + options.radius + 1);
      const sum =
        integral[bottom * stride + right]! -
        integral[top * stride + right]! -
        integral[bottom * stride + left]! +
        integral[top * stride + left]!;
      const mean = sum / ((bottom - top) * (right - left));

      if (gray.data[index]! < mean * options.darkShare) {
        mask.data[index] = 1;
      }
    }
  }

  return mask;
};

/** Otsu threshold of the pixels inside `rect` (between-class variance maximum). */
export const computeOtsuThreshold = (image: GrayImage, rect: PixelRect): number => {
  const histogram = new Float64Array(256);
  let total = 0;

  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      histogram[image.data[y * image.width + x]!]! += 1;
      total += 1;
    }
  }

  let sumAll = 0;

  for (let value = 0; value < 256; value += 1) {
    sumAll += value * histogram[value]!;
  }

  let weightBackground = 0;
  let sumBackground = 0;
  let bestVariance = -1;
  let threshold = 128;

  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value]!;

    if (weightBackground === 0 || weightBackground === total) {
      continue;
    }

    sumBackground += value * histogram[value]!;

    const weightForeground = total - weightBackground;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }

  return threshold;
};

/** Copy of `rect` (clamped to the image). */
export const cropGray = (image: GrayImage, rect: PixelRect): GrayImage => {
  const left = Math.max(0, Math.round(rect.left));
  const top = Math.max(0, Math.round(rect.top));
  const right = Math.min(image.width, Math.round(rect.right));
  const bottom = Math.min(image.height, Math.round(rect.bottom));
  const out = createGray(Math.max(0, right - left), Math.max(0, bottom - top));

  for (let y = 0; y < out.height; y += 1) {
    out.data.set(
      image.data.subarray((top + y) * image.width + left, (top + y) * image.width + right),
      y * out.width,
    );
  }

  return out;
};

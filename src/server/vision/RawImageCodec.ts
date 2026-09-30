import sharp from 'sharp';

import { CHANNELS, type RawImage } from '@/server/vision/VisionGeometry';

/** JPEG quality of warped tables and strips sent to the provider. */
export const PIPELINE_JPEG_QUALITY = 90;

/** Decodes any supported image into packed 8-bit sRGB (alpha removed). */
export const decodeRaw = async (bytes: Buffer): Promise<RawImage> => {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== CHANNELS) {
    throw new Error(`Unexpected channel count ${info.channels}`);
  }

  return { data, width: info.width, height: info.height };
};

export const encodeRawJpeg = async (raw: RawImage, quality = PIPELINE_JPEG_QUALITY): Promise<Buffer> =>
  sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: CHANNELS } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

import sharp from 'sharp';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { type VisionImage } from '@/server/vision/VisionProvider';

/** Long-edge limit for images sent to the vision provider. */
export const VISION_MAX_EDGE_PX = 2576;
/** Provider image payload limit is 5MB; stay safely below it. */
export const VISION_MAX_BYTES = 5 * 1024 * 1024 - 64 * 1024;

const JPEG_QUALITY_STEPS = [85, 75, 65, 55, 45];

/**
 * Copy of the source for the provider only (the stored original is unchanged): EXIF rotation applied,
 * long edge ≤ 2576px (never enlarged), re-encoded as JPEG with quality lowered until it fits < 5MB.
 */
export const prepareImageForVision = async (bytes: Buffer): Promise<VisionImage> => {
  const resized = sharp(bytes)
    .rotate()
    .resize({
      width: VISION_MAX_EDGE_PX,
      height: VISION_MAX_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' });

  for (const quality of JPEG_QUALITY_STEPS) {
    const encoded = await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer();

    if (encoded.length <= VISION_MAX_BYTES) {
      return { bytes: encoded, mime: ImageMimeType.JPEG };
    }
  }

  throw new Error('Image could not be reduced below the provider size limit');
};

import sharp, { type Metadata } from 'sharp';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { detectImageSignature } from '@/domain/ImageSignature';
import { ApiError } from '@/server/http/ApiError';

export const MIN_IMAGE_SIDE_PX = 200;

export type UploadLimits = {
  maxBytes: number;
  maxPixels: number;
};

export type ValidatedUpload = {
  mime: ImageMimeType;
  width: number;
  height: number;
};

const SHARP_FORMAT_BY_MIME: Record<ImageMimeType, string> = {
  [ImageMimeType.JPEG]: 'jpeg',
  [ImageMimeType.PNG]: 'png',
  [ImageMimeType.WEBP]: 'webp',
  [ImageMimeType.HEIC]: 'heif',
};

const readMetadata = async (bytes: Buffer): Promise<Metadata> => {
  try {
    // Header-only read; limitInputPixels=false so oversized images get our own 413 instead of a sharp error.
    return await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new ApiError(ApiErrorCode.UNSUPPORTED_MEDIA_TYPE);
  }
};

/** Validates size, magic bytes (not the file name or client MIME) and pixel dimensions. */
export const validateUpload = async (bytes: Buffer, limits: UploadLimits): Promise<ValidatedUpload> => {
  if (bytes.length > limits.maxBytes) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  const mime = detectImageSignature(bytes);

  if (mime === ImageMimeType.HEIC) {
    throw new ApiError(ApiErrorCode.HEIC_UNSUPPORTED);
  }

  if (mime === null) {
    throw new ApiError(ApiErrorCode.UNSUPPORTED_MEDIA_TYPE);
  }

  const metadata = await readMetadata(bytes);
  const { width, height } = metadata;

  if (metadata.format !== SHARP_FORMAT_BY_MIME[mime] || !width || !height) {
    throw new ApiError(ApiErrorCode.UNSUPPORTED_MEDIA_TYPE);
  }

  if (width * height > limits.maxPixels) {
    throw new ApiError(ApiErrorCode.IMAGE_TOO_LARGE);
  }

  if (width < MIN_IMAGE_SIDE_PX || height < MIN_IMAGE_SIDE_PX) {
    throw new ApiError(ApiErrorCode.IMAGE_TOO_SMALL);
  }

  return { mime, width, height };
};

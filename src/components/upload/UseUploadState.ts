'use client';

import { useRouter } from 'next/navigation';
import { type ChangeEvent, useState } from 'react';

import { getErrorMessage, uploadRecognition } from '@/client/ApiClient';
import {
  ACCEPTED_IMAGE_TYPES,
  downscaleImage,
  ImageDecodeError,
  ImageTooLargeError,
} from '@/client/ImageDownscaler';

/** Upload is roughly 10× the transfer limit before decoding: bigger originals are rejected early. */
const MAX_ORIGINAL_MULTIPLIER = 10;

export const HEIC_GUIDANCE =
  '이 브라우저에서는 이 사진 형식(HEIC 등)을 열 수 없어요. 사진 앱에서 JPG로 내보내거나, 근무표를 화면에 띄워 스크린샷으로 올려 주세요.';

const isHeicLike = (file: File): boolean => /hei[cf]$/iu.test(file.type) || /\.hei[cf]$/iu.test(file.name);

export type UploadState = {
  isUploading: boolean;
  statusText: string | null;
  error: string | null;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
};

/**
 * Client-side checks are for UX only (the server re-validates everything): type, a generous size
 * bound, then downscale to JPEG below `uploadMaxBytes` and upload.
 */
export const useUploadState = (uploadMaxBytes: number): UploadState => {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];

    input.value = '';

    if (!file) {
      return;
    }

    setError(null);

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) && !isHeicLike(file) && file.type !== '') {
      setError('JPG, PNG, WebP 사진만 올릴 수 있어요.');

      return;
    }

    if (file.size > uploadMaxBytes * MAX_ORIGINAL_MULTIPLIER) {
      setError('사진 파일이 너무 커요. 스크린샷이나 더 작은 사진을 올려 주세요.');

      return;
    }

    setIsUploading(true);

    try {
      setStatusText('사진을 준비하고 있어요…');

      const prepared = await downscaleImage(file, uploadMaxBytes);

      setStatusText('사진을 올리고 있어요…');

      const { id } = await uploadRecognition(prepared.blob, prepared.filename);

      setStatusText('업로드 완료. 근무표를 읽으러 가요…');
      router.push(`/recognitions/${id}`);
    } catch (caught: unknown) {
      setIsUploading(false);
      setStatusText(null);

      if (caught instanceof ImageDecodeError) {
        setError(HEIC_GUIDANCE);

        return;
      }

      if (caught instanceof ImageTooLargeError) {
        setError('사진을 충분히 줄이지 못했어요. 스크린샷이나 더 작은 사진을 올려 주세요.');

        return;
      }

      setError(getErrorMessage(caught));
    }
  };

  return { isUploading, statusText, error, handleFileChange };
};

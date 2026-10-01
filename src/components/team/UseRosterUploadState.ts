'use client';

import { useRouter } from 'next/navigation';
import { type ChangeEvent, type FormEvent, useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import {
  ACCEPTED_IMAGE_TYPES,
  downscaleImage,
  ImageDecodeError,
  ImageTooLargeError,
} from '@/client/ImageDownscaler';
import { uploadTeamRoster } from '@/client/TeamApiClient';
import { HEIC_GUIDANCE } from '@/components/upload/UseUploadState';
import { isValidYearMonth } from '@/domain/YearMonth';

/** Same generous pre-decode bound as the personal upload (the server re-validates everything). */
const MAX_ORIGINAL_MULTIPLIER = 10;

/** Team roster upload: photo + required authority consent + optional month → the roster screen. */
export const useRosterUploadState = (teamId: string, uploadMaxBytes: number) => {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isAuthorityConfirmed, setIsAuthorityConfirmed] = useState(false);
  const [yearMonth, setYearMonth] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = file !== null && isAuthorityConfirmed && !isUploading;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.currentTarget.files?.[0] ?? null;

    setError(null);

    if (picked && picked.type !== '' && !ACCEPTED_IMAGE_TYPES.includes(picked.type)) {
      setError('JPG, PNG, WebP 사진만 올릴 수 있어요.');
      setFile(null);

      return;
    }

    if (picked && picked.size > uploadMaxBytes * MAX_ORIGINAL_MULTIPLIER) {
      setError('사진 파일이 너무 커요. 스크린샷이나 더 작은 사진을 올려 주세요.');
      setFile(null);

      return;
    }

    setFile(picked);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file || !isAuthorityConfirmed || isUploading) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      setStatusText('사진을 준비하고 있어요…');

      const prepared = await downscaleImage(file, uploadMaxBytes);

      setStatusText('사진을 올리고 있어요…');

      const { rosterId } = await uploadTeamRoster(teamId, {
        file: prepared.blob,
        filename: prepared.filename,
        authorityConfirmed: true,
        yearMonth: isValidYearMonth(yearMonth) ? yearMonth : null,
      });

      setStatusText('업로드 완료. 팀원 근무를 읽으러 가요…');
      router.push(`/teams/${teamId}/rosters/${rosterId}`);
    } catch (caught: unknown) {
      setIsUploading(false);
      setStatusText(null);

      if (caught instanceof ImageDecodeError) {
        setError(HEIC_GUIDANCE);

        return;
      }

      setError(
        caught instanceof ImageTooLargeError
          ? '사진을 충분히 줄이지 못했어요. 스크린샷이나 더 작은 사진을 올려 주세요.'
          : getErrorMessage(caught),
      );
    }
  };

  return {
    file,
    isAuthorityConfirmed,
    yearMonth,
    isUploading,
    statusText,
    error,
    canSubmit,
    setIsAuthorityConfirmed,
    setYearMonth,
    handleFileChange,
    handleSubmit,
  };
};

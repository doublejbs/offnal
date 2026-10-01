import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ApiError } from '@/server/errors/ApiError';

/** Allowance for multipart boundaries and headers on top of the file size limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MISSING_FILE_MESSAGE = '사진 파일을 선택해 주세요.';

export type UploadedForm = {
  bytes: Buffer;
  form: FormData;
};

/** Reads a multipart body with a `file` field, refusing oversized bodies before and after parsing. */
export const readUploadedForm = async (request: NextRequest, maxBytes: number): Promise<UploadedForm> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);

  if (declaredLength > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: MISSING_FILE_MESSAGE });
  }

  const file = form.get('file');

  if (!(file instanceof File)) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: MISSING_FILE_MESSAGE });
  }

  if (file.size > maxBytes) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  return { bytes: Buffer.from(await file.arrayBuffer()), form };
};

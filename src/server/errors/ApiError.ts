import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  [ApiErrorCode.AUTH_REQUIRED]: 401,
  [ApiErrorCode.PAYMENT_REQUIRED]: 402,
  [ApiErrorCode.NOT_FOUND]: 404,
  [ApiErrorCode.REVISION_CONFLICT]: 409,
  [ApiErrorCode.EXPIRED]: 410,
  [ApiErrorCode.FILE_TOO_LARGE]: 413,
  [ApiErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ApiErrorCode.HEIC_UNSUPPORTED]: 415,
  [ApiErrorCode.IMAGE_TOO_SMALL]: 400,
  [ApiErrorCode.IMAGE_TOO_LARGE]: 413,
  [ApiErrorCode.PUBLISH_BLOCKED]: 422,
  [ApiErrorCode.RATE_LIMITED]: 429,
  [ApiErrorCode.PROVIDER_ERROR]: 502,
  [ApiErrorCode.PROVIDER_NOT_CONFIGURED]: 503,
  [ApiErrorCode.VALIDATION_ERROR]: 400,
  [ApiErrorCode.ALREADY_ENTITLED]: 409,
  [ApiErrorCode.FREE_MONTH_AVAILABLE]: 409,
  [ApiErrorCode.FORBIDDEN_ORIGIN]: 403,
  [ApiErrorCode.PAYMENT_FAILED]: 402,
  [ApiErrorCode.AMOUNT_MISMATCH]: 400,
  [ApiErrorCode.RECOGNITION_NOT_READY]: 409,
  [ApiErrorCode.DRAFT_NOT_EDITABLE]: 409,
  [ApiErrorCode.TEAM_MEMBERSHIP_CONFLICT]: 409,
  [ApiErrorCode.TEAM_MONTH_READ_ONLY]: 409,
  [ApiErrorCode.ROSTER_NOT_EDITABLE]: 409,
  [ApiErrorCode.INTERNAL_ERROR]: 500,
};

const DEFAULT_MESSAGE_BY_CODE: Record<ApiErrorCode, string> = {
  [ApiErrorCode.AUTH_REQUIRED]: '로그인이 필요해요.',
  [ApiErrorCode.PAYMENT_REQUIRED]: '이 달을 저장하려면 이용권 구매가 필요해요.',
  [ApiErrorCode.NOT_FOUND]: '요청한 내용을 찾을 수 없어요.',
  [ApiErrorCode.REVISION_CONFLICT]: '다른 곳에서 먼저 수정되었어요. 최신 내용을 불러와 주세요.',
  [ApiErrorCode.EXPIRED]: '보관 기간이 지나 더 이상 사용할 수 없어요. 사진을 다시 올려 주세요.',
  [ApiErrorCode.FILE_TOO_LARGE]: '파일이 너무 커요. 더 작은 사진을 올려 주세요.',
  [ApiErrorCode.UNSUPPORTED_MEDIA_TYPE]: 'JPG, PNG, WebP 사진만 올릴 수 있어요.',
  [ApiErrorCode.HEIC_UNSUPPORTED]:
    'HEIC 사진은 아직 지원하지 않아요. 사진 앱에서 JPG로 내보내거나 스크린샷으로 올려 주세요.',
  [ApiErrorCode.IMAGE_TOO_SMALL]: '사진이 너무 작아요. 근무표가 잘 보이게 다시 찍어 주세요.',
  [ApiErrorCode.IMAGE_TOO_LARGE]: '사진 해상도가 너무 커요. 더 작은 사진을 올려 주세요.',
  [ApiErrorCode.PUBLISH_BLOCKED]: '확인이 필요한 항목이 남아 있어 저장할 수 없어요.',
  [ApiErrorCode.RATE_LIMITED]: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  [ApiErrorCode.PROVIDER_ERROR]: '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  [ApiErrorCode.PROVIDER_NOT_CONFIGURED]: '아직 연결되지 않은 기능이에요. 설정을 기다리고 있어요.',
  [ApiErrorCode.VALIDATION_ERROR]: '입력한 내용을 다시 확인해 주세요.',
  [ApiErrorCode.ALREADY_ENTITLED]: '이미 이용권이 있는 달이에요.',
  [ApiErrorCode.FREE_MONTH_AVAILABLE]: '무료로 저장할 수 있는 달이 남아 있어요.',
  [ApiErrorCode.FORBIDDEN_ORIGIN]: '허용되지 않은 요청이에요.',
  [ApiErrorCode.PAYMENT_FAILED]: '결제가 완료되지 않았어요.',
  [ApiErrorCode.AMOUNT_MISMATCH]: '결제 금액이 올바르지 않아요.',
  [ApiErrorCode.RECOGNITION_NOT_READY]: '아직 근무표를 읽는 중이에요.',
  [ApiErrorCode.DRAFT_NOT_EDITABLE]: '이미 저장했거나 취소한 초안이라 수정할 수 없어요.',
  [ApiErrorCode.TEAM_MEMBERSHIP_CONFLICT]: '지금은 처리할 수 없는 팀 참여 요청이에요.',
  [ApiErrorCode.TEAM_MONTH_READ_ONLY]: '팀 근무표는 관리자만 수정할 수 있어요.',
  [ApiErrorCode.ROSTER_NOT_EDITABLE]: '배포된 근무표는 바로 고칠 수 없어요. 새 초안을 만들어 수정해 주세요.',
  [ApiErrorCode.INTERNAL_ERROR]: '일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
};

export type ApiErrorOptions = {
  message?: string;
  details?: Record<string, unknown>;
};

/** Expected, user-facing API failure. `message` is Korean text safe to show. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ApiErrorCode, options: ApiErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGE_BY_CODE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
  }
}

export const getStatusForCode = (code: ApiErrorCode): number => STATUS_BY_CODE[code];

export const DRAFT_EXPIRED_MESSAGE = '초안 보관 기간이 지났어요.';
export const SOURCE_GONE_MESSAGE = '원본 사진이 삭제되었거나 보관 기간이 지났어요.';

import { formatDayOnly } from '@/client/MonthLayout';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { hasCompleteTimes } from '@/domain/ShiftTime';
import { getZonedParts } from '@/domain/TimeZone';
import { type MonthAccessInfo } from '@/domain/types/api/MonthAccessInfo';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { type ReviewSummary } from '@/domain/types/ReviewSummary';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** Native Korean counters read more naturally than digits for small numbers ("두 달"). */
const NATIVE_COUNTERS = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatPrice = (priceKrw: number): string => `${priceKrw.toLocaleString('ko-KR')}원`;

/** 2 → "두 달" */
export const formatMonthCount = (count: number): string => {
  const native = NATIVE_COUNTERS[count - 1];

  return native ? `${native} 달` : `${count}달`;
};

/** 1 → "첫 번째", 2 → "두 번째" */
export const formatOrdinal = (value: number): string => {
  if (value === 1) {
    return '첫 번째';
  }

  const native = NATIVE_COUNTERS[value - 1];

  return native ? `${native} 번째` : `${value}번째`;
};

export type AccessDescription = {
  text: string;
  requiresPayment: boolean;
};

/** Text under the save button. The decision itself always comes from the server. */
export const describeMonthAccess = (access: MonthAccessInfo, freeMonthLimit: number): AccessDescription => {
  if (access.monthAccess === MonthAccess.EXISTING) {
    return { text: '이미 등록한 달이라 추가 비용 없이 저장돼요', requiresPayment: false };
  }

  if (access.monthAccess === MonthAccess.TRIAL_AVAILABLE) {
    const ordinal = Math.max(1, freeMonthLimit - access.freeRemaining + 1);

    return { text: `${formatOrdinal(ordinal)} 무료 월로 저장돼요`, requiresPayment: false };
  }

  return { text: `${formatPrice(access.priceKrw)} 구매 후 저장`, requiresPayment: true };
};

const formatDayList = (dates: string[]): string => dates.map(formatDayOnly).join(', ');

export const formatReviewWarning = (review: ReviewSummary): string | null => {
  if (review.count === 0) {
    return null;
  }

  return `확인 필요한 날짜가 ${review.count}일 있어요: ${formatDayList(review.dates)}`;
};

/** Spec §16: "처음 보는 코드 2개: W, 연차 — 근무 시간 또는 휴무를 정해 주세요". */
export const formatUndefinedCodesWarning = (codes: string[]): string | null => {
  if (codes.length === 0) {
    return null;
  }

  return `처음 보는 코드 ${codes.length}개: ${codes.join(', ')} — 근무 시간 또는 휴무를 정해 주세요`;
};

export const describeBlocker = (blocker: PublishBlocker): string => {
  if (blocker.reason === PublishBlockReason.UNCONFIRMED_DATES) {
    return `근무를 확인하지 않은 날짜 ${blocker.dates.length}일: ${formatDayList(blocker.dates)}`;
  }

  if (blocker.reason === PublishBlockReason.MISSING_TIMES) {
    return `근무 시간을 입력하지 않은 코드: ${blocker.codes.join(', ')}`;
  }

  return `등록되지 않은 코드: ${blocker.codes.join(', ')}`;
};

/** "07:00–16:00", "22:30–다음 날 07:30", "휴무", or a prompt when times are missing. */
export const formatShiftTime = (definition: ShiftDefinition | undefined): string => {
  if (!definition) {
    return '등록되지 않은 코드예요';
  }

  if (definition.isOff) {
    return '휴무';
  }

  if (!hasCompleteTimes(definition)) {
    return '시간을 입력해 주세요';
  }

  const nextDay = definition.endsNextDay ? '다음 날 ' : '';

  return `${definition.startTime}–${nextDay}${definition.endTime}`;
};

/** "2026.09.29 18:30" in Asia/Seoul. */
export const formatDateTime = (iso: string): string => {
  const parts = getZonedParts(new Date(iso));

  return `${parts.year}.${pad2(parts.month)}.${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
};

const REVIEW_REASON_TEXT: Record<ShiftReviewReason, string> = {
  [ShiftReviewReason.UNREADABLE]: '원본 칸을 읽지 못했어요',
  [ShiftReviewReason.MISSING_DATE]: '원본에서 이 날짜를 찾지 못했어요',
  [ShiftReviewReason.UNDEFINED_CODE]: '근무표에 설명이 없는 코드예요',
  [ShiftReviewReason.AMBIGUOUS]: '글자가 분명하지 않아요',
  [ShiftReviewReason.DUPLICATE_DATE]: '같은 날짜가 두 번 인식됐어요',
};

export const describeReviewReason = (reason: ShiftReviewReason): string => REVIEW_REASON_TEXT[reason];

const RECOGNITION_ERROR_MESSAGES: Record<RecognitionErrorCode, string> = {
  [RecognitionErrorCode.NO_TABLE]: '사진에서 근무표를 찾지 못했어요. 표 전체가 보이게 다시 찍어 주세요.',
  [RecognitionErrorCode.UNREADABLE]:
    '사진이 흐리거나 어두워 글자를 읽지 못했어요. 밝은 곳에서 다시 찍어 주세요.',
  [RecognitionErrorCode.MONTH_NOT_FOUND]: '근무표의 연·월을 찾지 못했어요. 날짜가 보이게 다시 찍어 주세요.',
  [RecognitionErrorCode.NO_NAMES]: '근무표에서 이름을 찾지 못했어요. 이름 열이 보이게 다시 찍어 주세요.',
  [RecognitionErrorCode.PROVIDER_ERROR]: '근무표를 읽는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  [RecognitionErrorCode.PROVIDER_TIMEOUT]: '근무표를 읽는 데 시간이 너무 오래 걸렸어요. 다시 시도해 주세요.',
  [RecognitionErrorCode.PROVIDER_NOT_CONFIGURED]:
    '근무표 인식 기능이 아직 연결되지 않았어요. 설정을 기다리고 있어요.',
  [RecognitionErrorCode.SOURCE_MISSING]: '올린 사진을 찾을 수 없어요. 사진을 다시 올려 주세요.',
};

export const recognitionErrorMessage = (code: RecognitionErrorCode | null): string =>
  code ? RECOGNITION_ERROR_MESSAGES[code] : '근무표를 읽지 못했어요. 다시 시도해 주세요.';

/** Source cell text: undefined = no source cell; null = the model could not read it; empty string = the cell was blank. */
export const formatRawText = (rawText: string | null | undefined): string => {
  if (rawText === undefined) {
    return '원본에서 찾지 못함';
  }

  if (rawText === null) {
    return '읽지 못함';
  }

  return rawText.trim() ? rawText : '빈칸';
};

/** Legend text next to a code badge: "휴무" for off codes, "데이 · 07:00–16:00" otherwise (no repeats). */
export const formatLegendText = (definition: ShiftDefinition): string => {
  const time = formatShiftTime(definition);

  if (definition.isOff) {
    return definition.label;
  }

  return definition.label === definition.code ? time : `${definition.label} · ${time}`;
};

/** One-line summary including the code: "OFF · 휴무", "D · 데이 · 07:00–16:00". */
export const formatDefinitionSummary = (definition: ShiftDefinition): string =>
  `${definition.code} · ${formatLegendText(definition)}`;

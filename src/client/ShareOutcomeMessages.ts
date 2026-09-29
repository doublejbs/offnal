import { ShareOutcome } from '@/domain/enums/ShareOutcome';

/** Status line after saving a month image; a cancelled share sheet shows nothing (not an error). */
export const PNG_OUTCOME_MESSAGES: Record<ShareOutcome, string | null> = {
  [ShareOutcome.SHARED]: '이미지를 공유했어요.',
  [ShareOutcome.DOWNLOADED]: '이미지를 저장했어요. 다운로드 폴더나 사진첩을 확인해 주세요.',
  [ShareOutcome.COPIED]: null,
  [ShareOutcome.CANCELLED]: null,
  [ShareOutcome.FAILED]: null,
};

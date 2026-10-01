import { ShareOutcome } from '@/domain/enums/ShareOutcome';

/** Status line after saving a month image; a cancelled share sheet shows nothing (not an error). */
export const PNG_OUTCOME_MESSAGES: Record<ShareOutcome, string | null> = {
  [ShareOutcome.SHARED]: '이미지를 공유했어요.',
  [ShareOutcome.DOWNLOADED]: '이미지를 저장했어요. 다운로드 폴더나 사진첩을 확인해 주세요.',
  [ShareOutcome.COPIED]: null,
  [ShareOutcome.CANCELLED]: null,
  [ShareOutcome.FAILED]: null,
};

/** Status line after sharing or copying a link (share settings, team invites). */
export const SHARE_LINK_OUTCOME_MESSAGES: Record<ShareOutcome, string | null> = {
  [ShareOutcome.SHARED]: '링크를 공유했어요.',
  [ShareOutcome.COPIED]: '링크를 복사했어요. 원하는 곳에 붙여 넣어 보내 주세요.',
  [ShareOutcome.DOWNLOADED]: null,
  [ShareOutcome.CANCELLED]: null,
  [ShareOutcome.FAILED]: '자동으로 복사하지 못했어요. 위 링크를 길게 눌러 복사해 주세요.',
};

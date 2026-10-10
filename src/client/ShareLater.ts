import { getBrowserShareEnvironment, type ShareEnvironment, shareOrCopyLink } from '@/client/ShareOrDownload';
import { ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';
import { ShareOutcome } from '@/domain/enums/ShareOutcome';

/** "지금 사진이 없나요? 링크 보내 두기" (Spec §26.4): send yourself the service link for later. */

export const SHARE_LATER_BUTTON_TEXT = '지금 사진이 없나요? 링크 보내 두기';

export const SHARE_LATER_SHARE_TITLE = '오프날';

export const SHARE_LATER_SHARE_TEXT = '근무표 사진 한 장으로 내 근무 달력 만들기';

const SHARE_LATER_UTM_SOURCE = 'share_later';

const COPIED_MESSAGE = '링크를 복사했어요';

export type ShareLaterResult = {
  outcome: ShareOutcome;
  /** `share` when the share sheet opened (shared or cancelled), otherwise `copy` (Spec §26.5). */
  method: ShareLaterMethod;
  /** Status line; null when nothing needs saying (shared, or the sheet was dismissed). */
  message: string | null;
};

/** APP_URL + `?utm_source=share_later`. */
export const buildShareLaterUrl = (appUrl: string): string => {
  const url = new URL('/', appUrl);

  url.searchParams.set('utm_source', SHARE_LATER_UTM_SOURCE);

  return url.toString();
};

const describeOutcome = (outcome: ShareOutcome, url: string): string | null => {
  if (outcome === ShareOutcome.COPIED) {
    return COPIED_MESSAGE;
  }

  if (outcome === ShareOutcome.FAILED) {
    return `자동으로 복사하지 못했어요. 이 주소를 보내 두세요: ${url}`;
  }

  return null;
};

/** Web Share (title, text, url), else the clipboard. A dismissed share sheet is a normal choice, not an error. */
export const shareLaterLink = async (
  url: string,
  environment: ShareEnvironment = getBrowserShareEnvironment(),
): Promise<ShareLaterResult> => {
  const outcome = await shareOrCopyLink(url, environment, {
    title: SHARE_LATER_SHARE_TITLE,
    text: SHARE_LATER_SHARE_TEXT,
  });
  const usedShareSheet = outcome === ShareOutcome.SHARED || outcome === ShareOutcome.CANCELLED;

  return {
    outcome,
    method: usedShareSheet ? ShareLaterMethod.SHARE : ShareLaterMethod.COPY,
    message: describeOutcome(outcome, url),
  };
};

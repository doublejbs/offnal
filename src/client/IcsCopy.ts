import { type PlatformInfo } from '@/client/PlatformDetect';
import { ClientPlatform } from '@/domain/enums/ClientPlatform';
import { InAppBrowser } from '@/domain/enums/InAppBrowser';
import { SharedIcsNotice } from '@/domain/enums/SharedIcsNotice';
import { SHARE_EXPIRED_MESSAGE } from '@/domain/ShareMessages';

export const ICS_DOWNLOADED_MESSAGE = '일정 파일을 받았어요. 파일을 열어 캘린더 앱으로 가져와 주세요.';

const THIRD_PARTY_NAVIGATE_HINT = '캘린더 추가 화면이 열리지 않으면 Safari에서 다시 시도해 주세요.';

const SAFARI_NAVIGATE_HINT = '캘린더 추가 화면이 열리지 않으면 잠시 후 다시 눌러 주세요.';

/**
 * Shown after an iOS navigation, which cannot report whether the import sheet opened. Only
 * Chrome/Firefox/Edge on iOS are pointed to Safari; Safari itself gets a neutral retry hint.
 */
export const getIcsNavigateHint = (info: PlatformInfo | null): string =>
  info?.isIosThirdPartyBrowser ? THIRD_PARTY_NAVIGATE_HINT : SAFARI_NAVIGATE_HINT;

export const SHARED_ICS_EXPIRED_MESSAGE = `${SHARE_EXPIRED_MESSAGE} 링크를 보낸 사람에게 새 링크를 요청해 주세요.`;

export const SHARED_ICS_RATE_LIMITED_MESSAGE = '요청이 많아요. 잠시 후 다시 시도해 주세요.';

const SHARED_ICS_NOTICE_MESSAGES: Record<SharedIcsNotice, string> = {
  [SharedIcsNotice.EXPIRED]: `캘린더에 추가하지 못했어요. ${SHARED_ICS_EXPIRED_MESSAGE}`,
  [SharedIcsNotice.RATE_LIMITED]: `캘린더에 추가하지 못했어요. ${SHARED_ICS_RATE_LIMITED_MESSAGE}`,
};

const SHARED_ICS_NOTICES = new Set<string>(Object.values(SharedIcsNotice));

const isSharedIcsNotice = (value: string): value is SharedIcsNotice => SHARED_ICS_NOTICES.has(value);

/** `?ics=` of /s/:token, set by the server when an iOS calendar open (open=1) failed. */
export const getSharedIcsNoticeMessage = (value: string | null): string | null =>
  value && isSharedIcsNotice(value) ? SHARED_ICS_NOTICE_MESSAGES[value] : null;

export const PAGE_URL_COPIED_MESSAGE = '주소를 복사했어요. Safari나 다른 브라우저 주소창에 붙여 넣어 주세요.';

export const PAGE_URL_COPY_FAILED_MESSAGE = '주소를 복사하지 못했어요. 아래 주소를 길게 눌러 복사해 주세요.';

const KAKAOTALK_NOTICE =
  '카카오톡 안에서는 캘린더에 바로 추가할 수 없어요. 오른쪽 아래 ⋯ 메뉴에서 ‘Safari로 열기’(안드로이드는 ‘다른 브라우저로 열기’) 후 다시 눌러 주세요.';

const GENERIC_IN_APP_NOTICE =
  '앱 안의 브라우저에서는 캘린더에 바로 추가할 수 없어요. 메뉴에서 ‘Safari로 열기’(안드로이드는 ‘다른 브라우저로 열기’) 후 다시 눌러 주세요.';

const PLATFORM_GUIDES: Partial<Record<ClientPlatform, string>> = {
  [ClientPlatform.IOS]: '캘린더 추가 화면이 열리면 ‘모두 추가’를 눌러 주세요.',
  [ClientPlatform.ANDROID]: '받은 파일을 열어 캘린더 앱으로 가져와 주세요.',
};

/** Extra import guide per platform; null (desktop or not yet detected) keeps the generic copy. */
export const getIcsPlatformGuide = (platform: ClientPlatform | null): string | null =>
  (platform && PLATFORM_GUIDES[platform]) ?? null;

export const getInAppBrowserNotice = (browser: InAppBrowser): string =>
  browser === InAppBrowser.KAKAOTALK ? KAKAOTALK_NOTICE : GENERIC_IN_APP_NOTICE;

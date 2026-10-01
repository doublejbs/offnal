import { ClientPlatform } from '@/domain/enums/ClientPlatform';
import { InAppBrowser } from '@/domain/enums/InAppBrowser';

export const ICS_DOWNLOADED_MESSAGE = '일정 파일을 받았어요. 파일을 열어 캘린더 앱으로 가져와 주세요.';

/** Shown after an iOS navigation, which cannot report whether the import sheet opened. */
export const ICS_NAVIGATE_HINT = '캘린더 추가 화면이 열리지 않으면 Safari에서 다시 시도해 주세요.';

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

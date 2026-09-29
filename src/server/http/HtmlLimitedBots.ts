import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots';

/** KakaoTalk link-preview scraper UA token (`kakaotalk-scrap/1.0; +https://devtalk.kakao.com/…`). */
export const KAKAO_SCRAPER_UA_PATTERN = 'kakaotalk-scrap';

/**
 * Next's default HTML-limited bots plus the KakaoTalk scraper: these get a blocking render so og/meta
 * tags are always in <head>, never streamed into <body> (Kakao reads only <head>).
 */
export const HTML_LIMITED_BOTS = new RegExp(
  `${HTML_LIMITED_BOT_UA_RE.source}|${KAKAO_SCRAPER_UA_PATTERN}`,
  'i',
);

import { describe, expect, it, vi } from 'vitest';

import {
  getIcsNavigateHint,
  getIcsPlatformGuide,
  getInAppBrowserNotice,
  getSharedIcsNoticeMessage,
  ICS_DOWNLOADED_MESSAGE,
} from '@/client/IcsCopy';
import { runIcsOpen, type IcsOpenFlowInput } from '@/client/IcsOpenFlow';
import { resolveIcsOpenMethod } from '@/client/IcsOpenMethodResolver';
import { type PlatformInfo } from '@/client/PlatformDetect';
import { buildIcsUrl, buildSharedIcsUrl } from '@/client/IcsUrls';
import { ClientPlatform } from '@/domain/enums/ClientPlatform';
import { IcsOpenMethod } from '@/domain/enums/IcsOpenMethod';
import { InAppBrowser } from '@/domain/enums/InAppBrowser';

const info = (
  platform: ClientPlatform,
  inAppBrowser = InAppBrowser.NONE,
  isIosThirdPartyBrowser = false,
): PlatformInfo => ({ platform, inAppBrowser, isIosThirdPartyBrowser });

const NAVIGATE_URL = '/api/calendar/2026-10/export.ics?includeOff=1&open=1';

const createInput = (overrides: Partial<IcsOpenFlowInput>): IcsOpenFlowInput => ({
  info: info(ClientPlatform.DESKTOP),
  navigateUrl: NAVIGATE_URL,
  preflight: false,
  fetchIcs: vi.fn().mockResolvedValue(new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' })),
  saveBlob: vi.fn(),
  navigate: vi.fn(),
  ...overrides,
});

describe('runIcsOpen', () => {
  it('shows the in-app notice without fetching or navigating', async () => {
    const input = createInput({ info: info(ClientPlatform.IOS, InAppBrowser.KAKAOTALK), preflight: true });

    await expect(runIcsOpen(input)).resolves.toBe(IcsOpenMethod.IN_APP_NOTICE);
    expect(input.fetchIcs).not.toHaveBeenCalled();
    expect(input.navigate).not.toHaveBeenCalled();
    expect(input.saveBlob).not.toHaveBeenCalled();
  });

  it('preflights on iOS (owner) and then navigates to the open=1 URL without saving', async () => {
    const input = createInput({ info: info(ClientPlatform.IOS), preflight: true });

    await expect(runIcsOpen(input)).resolves.toBe(IcsOpenMethod.NAVIGATE);
    expect(input.fetchIcs).toHaveBeenCalledTimes(1);
    expect(input.navigate).toHaveBeenCalledWith(NAVIGATE_URL);
    expect(input.saveBlob).not.toHaveBeenCalled();
  });

  it('does not navigate when the iOS preflight fails', async () => {
    const failure = new Error('expired');
    const input = createInput({
      info: info(ClientPlatform.IOS),
      preflight: true,
      fetchIcs: vi.fn().mockRejectedValue(failure),
    });

    await expect(runIcsOpen(input)).rejects.toBe(failure);
    expect(input.navigate).not.toHaveBeenCalled();
  });

  it('navigates directly on iOS without a preflight (shared link: the server redirects failures)', async () => {
    const input = createInput({ info: info(ClientPlatform.IOS), preflight: false });

    await expect(runIcsOpen(input)).resolves.toBe(IcsOpenMethod.NAVIGATE);
    expect(input.fetchIcs).not.toHaveBeenCalled();
    expect(input.navigate).toHaveBeenCalledWith(NAVIGATE_URL);
  });

  it.each([info(ClientPlatform.ANDROID), info(ClientPlatform.DESKTOP), null])(
    'downloads the blob elsewhere (%o)',
    async (platformInfo) => {
      const input = createInput({ info: platformInfo, preflight: true });

      await expect(runIcsOpen(input)).resolves.toBe(IcsOpenMethod.DOWNLOAD);
      expect(input.fetchIcs).toHaveBeenCalledTimes(1);
      expect(input.saveBlob).toHaveBeenCalledTimes(1);
      expect(input.navigate).not.toHaveBeenCalled();
    },
  );
});

describe('ICS URLs', () => {
  it('builds the owner ICS URL with includeOff and an optional open flag', () => {
    expect(buildIcsUrl('2026-10', false)).toBe('/api/calendar/2026-10/export.ics?includeOff=0');
    expect(buildIcsUrl('2026-10', true, true)).toBe('/api/calendar/2026-10/export.ics?includeOff=1&open=1');
  });

  it('builds the shared ICS URL with month, includeOff and an optional open flag', () => {
    expect(buildSharedIcsUrl('tok/en', '2026-10', false)).toBe(
      '/api/shared/tok%2Fen/export.ics?month=2026-10&includeOff=0',
    );
    expect(buildSharedIcsUrl('token', '2026-10', true, true)).toBe(
      '/api/shared/token/export.ics?month=2026-10&includeOff=1&open=1',
    );
  });
});

describe('resolveIcsOpenMethod', () => {
  it.each([
    [ClientPlatform.IOS, InAppBrowser.KAKAOTALK, IcsOpenMethod.IN_APP_NOTICE],
    [ClientPlatform.ANDROID, InAppBrowser.KAKAOTALK, IcsOpenMethod.IN_APP_NOTICE],
    [ClientPlatform.IOS, InAppBrowser.INSTAGRAM, IcsOpenMethod.IN_APP_NOTICE],
    [ClientPlatform.ANDROID, InAppBrowser.OTHER_WEBVIEW, IcsOpenMethod.IN_APP_NOTICE],
    [ClientPlatform.IOS, InAppBrowser.NONE, IcsOpenMethod.NAVIGATE],
    [ClientPlatform.ANDROID, InAppBrowser.NONE, IcsOpenMethod.DOWNLOAD],
    [ClientPlatform.DESKTOP, InAppBrowser.NONE, IcsOpenMethod.DOWNLOAD],
  ])('%s + %s → %s', (platform, inAppBrowser, expected) => {
    expect(resolveIcsOpenMethod({ platform, inAppBrowser, isIosThirdPartyBrowser: false })).toBe(expected);
  });
});

describe('IcsCopy', () => {
  it('uses platform-specific guides and keeps the desktop copy generic', () => {
    expect(getIcsPlatformGuide(ClientPlatform.IOS)).toBe(
      '캘린더 추가 화면이 열리면 ‘모두 추가’를 눌러 주세요.',
    );
    expect(getIcsPlatformGuide(ClientPlatform.ANDROID)).toBe('받은 파일을 열어 캘린더 앱으로 가져와 주세요.');
    expect(getIcsPlatformGuide(ClientPlatform.DESKTOP)).toBeNull();
    expect(getIcsPlatformGuide(null)).toBeNull();
  });

  it('names KakaoTalk in its in-app notice and stays generic for other in-app browsers', () => {
    expect(getInAppBrowserNotice(InAppBrowser.KAKAOTALK)).toBe(
      '카카오톡 안에서는 캘린더에 바로 추가할 수 없어요. 오른쪽 아래 ⋯ 메뉴에서 ‘Safari로 열기’(안드로이드는 ‘다른 브라우저로 열기’) 후 다시 눌러 주세요.',
    );

    for (const browser of [InAppBrowser.NAVER, InAppBrowser.INSTAGRAM, InAppBrowser.OTHER_WEBVIEW]) {
      const notice = getInAppBrowserNotice(browser);

      expect(notice).not.toContain('카카오톡');
      expect(notice).toContain('Safari로 열기');
    }
  });

  it('keeps the download message and suggests Safari only on third-party iOS browsers', () => {
    expect(ICS_DOWNLOADED_MESSAGE).toBe('일정 파일을 받았어요. 파일을 열어 캘린더 앱으로 가져와 주세요.');
    expect(getIcsNavigateHint(info(ClientPlatform.IOS, InAppBrowser.NONE, true))).toBe(
      '캘린더 추가 화면이 열리지 않으면 Safari에서 다시 시도해 주세요.',
    );
    expect(getIcsNavigateHint(info(ClientPlatform.IOS))).toBe(
      '캘린더 추가 화면이 열리지 않으면 잠시 후 다시 눌러 주세요.',
    );
    expect(getIcsNavigateHint(null)).not.toContain('Safari');
  });

  it('maps the shared page ics notice parameter', () => {
    expect(getSharedIcsNoticeMessage('expired')).toContain('링크를 보낸 사람에게 새 링크를 요청해 주세요.');
    expect(getSharedIcsNoticeMessage('rate_limited')).toContain('잠시 후 다시 시도해 주세요.');
    expect(getSharedIcsNoticeMessage('other')).toBeNull();
    expect(getSharedIcsNoticeMessage(null)).toBeNull();
  });
});

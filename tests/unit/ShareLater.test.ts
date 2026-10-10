import { describe, expect, it, vi } from 'vitest';

import {
  buildShareLaterUrl,
  SHARE_LATER_SHARE_TEXT,
  SHARE_LATER_SHARE_TITLE,
  shareLaterLink,
} from '@/client/ShareLater';
import { ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';
import { ShareOutcome } from '@/domain/enums/ShareOutcome';

const URL_TO_SHARE = 'https://offnal.example/?utm_source=share_later';

const abortError = (): Error => Object.assign(new Error('cancelled'), { name: 'AbortError' });

describe('share later (Spec §26.4)', () => {
  it('builds APP_URL + ?utm_source=share_later', () => {
    expect(buildShareLaterUrl('https://offnal.example')).toBe(URL_TO_SHARE);
    expect(buildShareLaterUrl('http://localhost:3100')).toBe('http://localhost:3100/?utm_source=share_later');
  });

  it('opens the share sheet with the title, text and url', async () => {
    const share = vi.fn(() => Promise.resolve());
    const writeClipboard = vi.fn(() => Promise.resolve());

    const result = await shareLaterLink(URL_TO_SHARE, { share, writeClipboard, download: vi.fn() });

    expect(share).toHaveBeenCalledWith({
      title: SHARE_LATER_SHARE_TITLE,
      text: SHARE_LATER_SHARE_TEXT,
      url: URL_TO_SHARE,
    });
    expect(SHARE_LATER_SHARE_TITLE).toBe('오프날');
    expect(SHARE_LATER_SHARE_TEXT).toBe('근무표 사진 한 장으로 내 근무 달력 만들기');
    expect(writeClipboard).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: ShareOutcome.SHARED, method: ShareLaterMethod.SHARE, message: null });
  });

  it('treats a cancelled share sheet as a normal choice (no message, no copy)', async () => {
    const writeClipboard = vi.fn(() => Promise.resolve());

    const result = await shareLaterLink(URL_TO_SHARE, {
      share: () => Promise.reject(abortError()),
      writeClipboard,
      download: vi.fn(),
    });

    expect(writeClipboard).not.toHaveBeenCalled();
    expect(result).toEqual({
      outcome: ShareOutcome.CANCELLED,
      method: ShareLaterMethod.SHARE,
      message: null,
    });
  });

  it('copies the link without Web Share, or when sharing fails', async () => {
    const writeClipboard = vi.fn(() => Promise.resolve());
    const withoutShare = await shareLaterLink(URL_TO_SHARE, { writeClipboard, download: vi.fn() });
    const shareFailed = await shareLaterLink(URL_TO_SHARE, {
      share: () => Promise.reject(new Error('NotAllowedError')),
      writeClipboard,
      download: vi.fn(),
    });

    expect(writeClipboard).toHaveBeenCalledWith(URL_TO_SHARE);

    for (const result of [withoutShare, shareFailed]) {
      expect(result).toEqual({
        outcome: ShareOutcome.COPIED,
        method: ShareLaterMethod.COPY,
        message: '링크를 복사했어요',
      });
    }
  });

  it('shows the link itself when the clipboard is unavailable', async () => {
    const result = await shareLaterLink(URL_TO_SHARE, {
      writeClipboard: () => Promise.reject(new Error('denied')),
      download: vi.fn(),
    });

    expect(result.outcome).toBe(ShareOutcome.FAILED);
    expect(result.method).toBe(ShareLaterMethod.COPY);
    expect(result.message).toContain(URL_TO_SHARE);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { shareOrCopyLink, shareOrDownloadFile, type ShareEnvironment } from '@/client/ShareOrDownload';
import { ShareOutcome } from '@/domain/enums/ShareOutcome';

const createAbortError = (): Error => {
  const error = new Error('Share canceled');

  error.name = 'AbortError';

  return error;
};

const createEnvironment = (overrides: Partial<ShareEnvironment> = {}): ShareEnvironment => ({
  download: vi.fn(),
  ...overrides,
});

const blob = new Blob(['png'], { type: 'image/png' });

describe('ShareOrDownload', () => {
  it('shares the file when the browser can share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const environment = createEnvironment({ canShare: () => true, share });

    await expect(shareOrDownloadFile(blob, 'offnal-2026-10.png', environment)).resolves.toBe(
      ShareOutcome.SHARED,
    );
    expect(share).toHaveBeenCalledTimes(1);

    const [data] = share.mock.calls[0] as [ShareData];

    expect(data.files?.[0]?.name).toBe('offnal-2026-10.png');
    expect(environment.download).not.toHaveBeenCalled();
  });

  it('treats AbortError as a user cancel, not an error, and does not download', async () => {
    const environment = createEnvironment({
      canShare: () => true,
      share: vi.fn().mockRejectedValue(createAbortError()),
    });

    await expect(shareOrDownloadFile(blob, 'a.png', environment)).resolves.toBe(ShareOutcome.CANCELLED);
    expect(environment.download).not.toHaveBeenCalled();
  });

  it('falls back to a download when file sharing is unsupported or fails', async () => {
    const unsupported = createEnvironment({ canShare: () => false, share: vi.fn() });

    await expect(shareOrDownloadFile(blob, 'a.png', unsupported)).resolves.toBe(ShareOutcome.DOWNLOADED);
    expect(unsupported.download).toHaveBeenCalledWith(blob, 'a.png');

    const noApi = createEnvironment();

    await expect(shareOrDownloadFile(blob, 'a.png', noApi)).resolves.toBe(ShareOutcome.DOWNLOADED);

    const failing = createEnvironment({
      canShare: () => true,
      share: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
    });

    await expect(shareOrDownloadFile(blob, 'a.png', failing)).resolves.toBe(ShareOutcome.DOWNLOADED);
    expect(failing.download).toHaveBeenCalledTimes(1);
  });

  it('shares a link, or copies it when sharing is unavailable', async () => {
    const share = vi.fn().mockResolvedValue(undefined);

    await expect(shareOrCopyLink('https://x/s/t', createEnvironment({ share }))).resolves.toBe(
      ShareOutcome.SHARED,
    );

    const writeClipboard = vi.fn().mockResolvedValue(undefined);

    await expect(shareOrCopyLink('https://x/s/t', createEnvironment({ writeClipboard }))).resolves.toBe(
      ShareOutcome.COPIED,
    );
    expect(writeClipboard).toHaveBeenCalledWith('https://x/s/t');
  });

  it('reports a cancelled link share and a failed copy', async () => {
    const cancelled = createEnvironment({ share: vi.fn().mockRejectedValue(createAbortError()) });

    await expect(shareOrCopyLink('u', cancelled)).resolves.toBe(ShareOutcome.CANCELLED);

    const failedCopy = createEnvironment({ writeClipboard: vi.fn().mockRejectedValue(new Error('denied')) });

    await expect(shareOrCopyLink('u', failedCopy)).resolves.toBe(ShareOutcome.FAILED);
    await expect(shareOrCopyLink('u', createEnvironment())).resolves.toBe(ShareOutcome.FAILED);
  });
});

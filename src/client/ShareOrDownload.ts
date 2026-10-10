import { ShareOutcome } from '@/domain/enums/ShareOutcome';

/** Browser capabilities used for sharing (injectable for tests). */
export type ShareEnvironment = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  writeClipboard?: (text: string) => Promise<void>;
  download: (blob: Blob, filename: string) => void;
};

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

/** Saves a blob through a temporary object URL and `a[download]`. */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

export const getBrowserShareEnvironment = (): ShareEnvironment => {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;

  return {
    share: nav?.share ? (data) => nav.share(data) : undefined,
    canShare: nav?.canShare ? (data) => nav.canShare(data) : undefined,
    writeClipboard: nav?.clipboard ? (text) => nav.clipboard.writeText(text) : undefined,
    download: downloadBlob,
  };
};

/**
 * Web Share with files when supported, otherwise a download. A cancelled share sheet (AbortError)
 * is a normal user choice: it reports CANCELLED and does not fall back to a download.
 */
export const shareOrDownloadFile = async (
  blob: Blob,
  filename: string,
  environment: ShareEnvironment = getBrowserShareEnvironment(),
): Promise<ShareOutcome> => {
  const file = new File([blob], filename, { type: blob.type });
  const data: ShareData = { files: [file] };

  if (environment.share && environment.canShare?.(data)) {
    try {
      await environment.share(data);

      return ShareOutcome.SHARED;
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return ShareOutcome.CANCELLED;
      }
    }
  }

  environment.download(blob, filename);

  return ShareOutcome.DOWNLOADED;
};

/** Share sheet title/text sent with a link (the clipboard gets the url only). */
export type ShareLinkMessage = {
  title?: string;
  text?: string;
};

/** Web Share for the link, otherwise the clipboard. FAILED means the caller shows a selectable field. */
export const shareOrCopyLink = async (
  url: string,
  environment: ShareEnvironment = getBrowserShareEnvironment(),
  message: ShareLinkMessage = {},
): Promise<ShareOutcome> => {
  if (environment.share) {
    try {
      await environment.share({ ...message, url });

      return ShareOutcome.SHARED;
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return ShareOutcome.CANCELLED;
      }
    }
  }

  if (!environment.writeClipboard) {
    return ShareOutcome.FAILED;
  }

  try {
    await environment.writeClipboard(url);

    return ShareOutcome.COPIED;
  } catch {
    return ShareOutcome.FAILED;
  }
};

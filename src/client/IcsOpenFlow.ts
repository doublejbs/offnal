import { resolveIcsOpenMethod } from '@/client/IcsOpenMethodResolver';
import { type PlatformInfo } from '@/client/PlatformDetect';
import { IcsOpenMethod } from '@/domain/enums/IcsOpenMethod';

export type IcsOpenFlowInput = {
  info: PlatformInfo | null;
  /** open=1 URL used for the iOS top-level navigation. */
  navigateUrl: string;
  /**
   * Fetch the file before navigating so errors surface in the page (owner). Shared links skip it:
   * a second request would consume the IP limit twice, and the server redirects failures instead.
   */
  preflight: boolean;
  fetchIcs: () => Promise<Blob>;
  saveBlob: (blob: Blob) => void;
  navigate: (url: string) => void;
};

/**
 * Click flow of "일정 파일 받기" (Spec §19): in-app browser → notice only (no request), iOS →
 * (optional preflight) + navigation, otherwise → blob download. Errors propagate to the caller.
 */
export const runIcsOpen = async (input: IcsOpenFlowInput): Promise<IcsOpenMethod> => {
  const method = resolveIcsOpenMethod(input.info);

  if (method === IcsOpenMethod.IN_APP_NOTICE) {
    return method;
  }

  if (method === IcsOpenMethod.NAVIGATE) {
    if (input.preflight) {
      await input.fetchIcs();
    }

    input.navigate(input.navigateUrl);

    return method;
  }

  input.saveBlob(await input.fetchIcs());

  return method;
};

/** Top-level same-origin navigation: cookies apply, and iOS opens the calendar import sheet. */
export const assignLocation = (url: string): void => {
  window.location.assign(url);
};

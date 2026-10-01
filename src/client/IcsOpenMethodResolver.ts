import { type PlatformInfo } from '@/client/PlatformDetect';
import { ClientPlatform } from '@/domain/enums/ClientPlatform';
import { IcsOpenMethod } from '@/domain/enums/IcsOpenMethod';
import { InAppBrowser } from '@/domain/enums/InAppBrowser';

/** In-app browsers first (they cannot import either way), then iOS navigation, else a download. */
export const resolveIcsOpenMethod = (info: PlatformInfo | null): IcsOpenMethod => {
  if (!info) {
    return IcsOpenMethod.DOWNLOAD;
  }

  if (info.inAppBrowser !== InAppBrowser.NONE) {
    return IcsOpenMethod.IN_APP_NOTICE;
  }

  if (info.platform === ClientPlatform.IOS) {
    return IcsOpenMethod.NAVIGATE;
  }

  return IcsOpenMethod.DOWNLOAD;
};

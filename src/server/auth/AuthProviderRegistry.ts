import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type OAuthAuthProvider } from '@/server/auth/AuthProvider';
import { createDevAuthProvider, type DevAuthProvider } from '@/server/auth/DevAuthProvider';
import { createGoogleAuthProvider } from '@/server/auth/GoogleAuthProvider';
import { getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/errors/ApiError';

export const OAUTH_CALLBACK_PATH = '/auth/callback';

/** Redirect-based provider by name. Not enabled → 404; enabled without keys → 503 PROVIDER_NOT_CONFIGURED. */
export const getOAuthProvider = (name: string): OAuthAuthProvider => {
  const config = getAppConfig();

  if (name !== AuthProviderType.GOOGLE || !config.authProviders.includes(AuthProviderType.GOOGLE)) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  if (!config.googleClientId || !config.googleClientSecret) {
    throw new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED, {
      message: 'Google 로그인이 아직 설정되지 않았어요.',
    });
  }

  return createGoogleAuthProvider({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: new URL(OAUTH_CALLBACK_PATH, config.appUrl).toString(),
  });
};

export const isDevLoginEnabled = (): boolean => getAppConfig().appMode === AppMode.DEMO;

export const getDevAuthProvider = (): DevAuthProvider => {
  if (!isDevLoginEnabled()) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return createDevAuthProvider();
};

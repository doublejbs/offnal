import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { createDevAuthProvider, type DevAuthProvider } from '@/server/auth/DevAuthProvider';
import { createKakaoAuthProvider, type KakaoAuthProvider } from '@/server/auth/KakaoAuthProvider';
import { createSupabaseRouteClient, type SupabaseRouteClient } from '@/server/auth/SupabaseServerClient';
import { getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/errors/ApiError';

export type KakaoLogin = {
  provider: KakaoAuthProvider;
  /** Carries the Supabase cookie writes (PKCE verifier, session) onto the redirect response. */
  supabase: SupabaseRouteClient;
};

export const isKakaoLoginEnabled = (): boolean =>
  getAppConfig().authProviders.includes(AuthProviderType.KAKAO);

/**
 * Kakao login bound to this request. Unknown or not enabled → 404; enabled without Supabase
 * settings → 503 PROVIDER_NOT_CONFIGURED (routes turn both into `login=failed` redirects).
 */
export const getKakaoLogin = (name: string, request: NextRequest): KakaoLogin => {
  if (name !== AuthProviderType.KAKAO || !isKakaoLoginEnabled()) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  const supabase = createSupabaseRouteClient(request);

  if (!supabase) {
    throw new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED, {
      message: '카카오 로그인이 아직 설정되지 않았어요.',
    });
  }

  return { provider: createKakaoAuthProvider(supabase.auth, getAppConfig().appUrl), supabase };
};

export const isDevLoginEnabled = (): boolean => getAppConfig().appMode === AppMode.DEMO;

export const getDevAuthProvider = (): DevAuthProvider => {
  if (!isDevLoginEnabled()) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return createDevAuthProvider();
};

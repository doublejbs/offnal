'use client';

import { usePublicConfig } from '@/components/ConfigProvider';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { LoginEmphasis } from '@/domain/enums/LoginEmphasis';

type LoginOptionsProps = {
  returnTo: string;
  primaryLabel: string;
  emphasis?: LoginEmphasis;
};

const buildKakaoHref = (returnTo: string): string =>
  `/auth/login?provider=${AuthProviderType.KAKAO}&returnTo=${encodeURIComponent(returnTo)}`;

/** Kakao speech-bubble symbol (Kakao Login design guide). */
const KakaoSymbol = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M9 1.5C4.58 1.5 1 4.31 1 7.78c0 2.24 1.5 4.2 3.75 5.31l-.96 3.5c-.08.3.26.54.52.37l4.18-2.77c.17.01.34.02.51.02 4.42 0 8-2.81 8-6.28S13.42 1.5 9 1.5Z"
    />
  </svg>
);

/**
 * Kakao login (via Supabase Auth) and, in demo mode only, a clearly labelled instant login form.
 * Kakao keeps its brand label and colors; the demo form gets the primary button when it is alone.
 */
const LoginOptions = ({ returnTo, primaryLabel, emphasis = LoginEmphasis.PRIMARY }: LoginOptionsProps) => {
  const { authProviders } = usePublicConfig();
  const hasKakao = authProviders.includes(AuthProviderType.KAKAO);
  const hasDev = authProviders.includes(AuthProviderType.DEV);
  const isSecondary = emphasis === LoginEmphasis.SECONDARY;

  if (!hasKakao && !hasDev) {
    return <div className="warning">아직 로그인 수단이 연결되지 않았어요. 설정을 기다리고 있어요.</div>;
  }

  return (
    <div className="stack">
      {hasKakao && (
        <a
          className={isSecondary ? 'secondary kakao-login compact' : 'primary kakao-login'}
          href={buildKakaoHref(returnTo)}
        >
          <KakaoSymbol />
          카카오로 로그인
        </a>
      )}
      {hasDev && (
        <form method="post" action="/auth/dev-login" className="stack" aria-label="데모 로그인">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="field m-0">
            <span>
              <strong>데모 로그인</strong> · 표시 이름 (실제 계정이 아니에요)
            </span>
            <input
              name="displayName"
              defaultValue="데모 사용자"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              autoComplete="off"
            />
          </label>
          <button type="submit" className={isSecondary || hasKakao ? 'secondary' : 'primary'}>
            {hasKakao ? '데모 로그인' : primaryLabel}
          </button>
        </form>
      )}
    </div>
  );
};

export default LoginOptions;

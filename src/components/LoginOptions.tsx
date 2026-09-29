'use client';

import { usePublicConfig } from '@/components/ConfigProvider';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';

type LoginOptionsProps = {
  returnTo: string;
  primaryLabel: string;
};

const buildGoogleHref = (returnTo: string): string =>
  `/auth/login?provider=${AuthProviderType.GOOGLE}&returnTo=${encodeURIComponent(returnTo)}`;

/**
 * Real provider links (Google) and, in demo mode only, a clearly labelled instant login form.
 * The first available provider gets the primary button.
 */
const LoginOptions = ({ returnTo, primaryLabel }: LoginOptionsProps) => {
  const { authProviders } = usePublicConfig();
  const hasGoogle = authProviders.includes(AuthProviderType.GOOGLE);
  const hasDev = authProviders.includes(AuthProviderType.DEV);

  if (!hasGoogle && !hasDev) {
    return <div className="warning">아직 로그인 수단이 연결되지 않았어요. 설정을 기다리고 있어요.</div>;
  }

  return (
    <div className="stack">
      {hasGoogle && (
        <a className="primary" href={buildGoogleHref(returnTo)}>
          {hasDev ? 'Google로 로그인' : primaryLabel}
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
          <button type="submit" className={hasGoogle ? 'secondary' : 'primary'}>
            {hasGoogle ? '데모 로그인' : primaryLabel}
          </button>
        </form>
      )}
    </div>
  );
};

export default LoginOptions;

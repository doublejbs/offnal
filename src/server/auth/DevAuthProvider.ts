import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type AuthProfile, type AuthProvider } from '@/server/auth/AuthProvider';
import { hashSha256Hex } from '@/server/crypto/TokenCrypto';

export const DEFAULT_DEV_DISPLAY_NAME = '데모 사용자';

export type DevAuthProvider = AuthProvider & {
  /** Same display name → same demo account. */
  createProfile: (displayName: string) => AuthProfile;
};

/** Demo-only instant login. Registry exposes it only when APP_MODE=demo. */
export const createDevAuthProvider = (): DevAuthProvider => ({
  kind: AuthProviderType.DEV,
  createProfile: (displayName) => {
    const name = displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) || DEFAULT_DEV_DISPLAY_NAME;

    return {
      provider: AuthProviderType.DEV,
      subject: hashSha256Hex(`dev:${name}`),
      email: null,
      displayName: name,
    };
  },
});

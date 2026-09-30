import { type AuthIdentityProvider } from '@/domain/enums/AuthIdentityProvider';
import { type AuthProviderType } from '@/domain/enums/AuthProviderType';

/** Identity returned after successful authentication, stored in `auth_identities`. */
export type AuthProfile = {
  provider: AuthIdentityProvider;
  /** Stable subject (Supabase Auth user ID, or the demo login hash). */
  subject: string;
  email: string | null;
  displayName: string;
};

export type AuthProvider = {
  readonly kind: AuthProviderType;
};

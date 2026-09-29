import { type AppMode } from '@/domain/enums/AppMode';
import { type AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { type VisionProviderType } from '@/domain/enums/VisionProviderType';

/** GET /api/config/public — non-secret settings for the UI. */
export type PublicConfigResponse = {
  appMode: AppMode;
  priceKrw: number;
  freeMonthLimit: number;
  /** Login buttons to show. `dev` appears only in demo mode (POST /auth/dev-login). */
  authProviders: AuthProviderType[];
  paymentProvider: PaymentProviderType;
  visionProvider: VisionProviderType;
  uploadMaxBytes: number;
};

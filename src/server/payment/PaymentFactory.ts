import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { type AppConfig, getAppConfig } from '@/server/config/AppConfig';
import { createMockPaymentProvider } from '@/server/payment/MockPaymentProvider';
import { type PaymentProvider } from '@/server/payment/PaymentProvider';
import { createTossPaymentProvider } from '@/server/payment/TossPaymentProvider';

const TOSS_TIMEOUT_MS = 15_000;

type PaymentGlobal = typeof globalThis & {
  /** Cached per AppConfig instance, so `resetAppConfigForTesting` also resets the provider. */
  __offnalPaymentProvider?: { config: AppConfig; provider: PaymentProvider };
  __offnalPaymentOverride?: PaymentProvider | null;
};

const paymentGlobal = globalThis as PaymentGlobal;

const createPaymentProviderFromConfig = (config: AppConfig): PaymentProvider => {
  if (config.paymentProvider === PaymentProviderType.MOCK) {
    // AppConfig already refuses this combination; kept as a second guard.
    if (config.offnalEnv === OffnalEnv.PRODUCTION) {
      throw new Error('Mock payment provider is not allowed in production');
    }

    return createMockPaymentProvider();
  }

  return createTossPaymentProvider({
    clientKey: config.tossClientKey,
    secretKey: config.tossSecretKey,
    timeoutMs: TOSS_TIMEOUT_MS,
  });
};

export const getPaymentProvider = (): PaymentProvider => {
  if (paymentGlobal.__offnalPaymentOverride) {
    return paymentGlobal.__offnalPaymentOverride;
  }

  const config = getAppConfig();
  const cached = paymentGlobal.__offnalPaymentProvider;

  if (cached?.config === config) {
    return cached.provider;
  }

  const provider = createPaymentProviderFromConfig(config);

  paymentGlobal.__offnalPaymentProvider = { config, provider };

  return provider;
};

/** Overrides the provider returned by `getPaymentProvider` (null clears). Tests only. */
export const setPaymentProviderForTesting = (provider: PaymentProvider | null): void => {
  paymentGlobal.__offnalPaymentOverride = provider;
};

import { BillingMode } from '@/domain/enums/BillingMode';

/** Initial proposal values (README). The only place that fixes pricing defaults. */
export const DEFAULT_PRICE_KRW = 990;
export const DEFAULT_FREE_MONTH_LIMIT = 2;
export const PRICE_CURRENCY = 'KRW';

/** The pricing fields of AppConfig. */
export type PricingSource = {
  priceKrw: number;
  freeMonthLimit: number;
};

export type Pricing = {
  priceKrw: number;
  freeMonthLimit: number;
  currency: string;
};

/** Effective pricing from the parsed config (PRICE_KRW / FREE_MONTH_LIMIT overrides applied). */
export const getPricing = (config: PricingSource): Pricing => ({
  priceKrw: config.priceKrw,
  freeMonthLimit: config.freeMonthLimit,
  currency: PRICE_CURRENCY,
});

/** Beta free mode: no payment, trial or price anywhere (Spec §20). Pure, so client-safe callers may use it. */
export const isBetaFree = (config: { billingMode: BillingMode }): boolean =>
  config.billingMode === BillingMode.BETA_FREE;

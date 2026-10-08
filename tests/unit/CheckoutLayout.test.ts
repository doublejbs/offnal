import { afterEach, describe, expect, it } from 'vitest';

import CheckoutLayout from '@/app/checkout/layout';
import { createEnvSandbox } from '../helpers/EnvSandbox';

const envSandbox = createEnvSandbox();

afterEach(() => {
  envSandbox.restore();
});

describe('CheckoutLayout', () => {
  it('renders checkout screens in paid mode', () => {
    expect(CheckoutLayout({ children: 'checkout' })).toBe('checkout');
  });

  it('is not found in beta free mode', () => {
    envSandbox.set({ BILLING_MODE: 'beta_free' });

    expect(() => CheckoutLayout({ children: 'checkout' })).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

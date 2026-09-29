import { PaymentClientMode } from '@/domain/enums/PaymentClientMode';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { PRICE_CURRENCY } from '@/server/config/PricingConfig';
import {
  type ConfirmPaymentInput,
  type PaymentProvider,
  type ProviderPaymentResult,
  type ProviderPaymentSuccess,
} from '@/server/payment/PaymentProvider';

export const MOCK_SUCCESS_PREFIX = 'mock_success_';
export const MOCK_FAIL_PREFIX = 'mock_fail_';
export const MOCK_DECLINED_CODE = 'MOCK_DECLINED';

const NOT_FOUND_CODE = 'MOCK_PAYMENT_NOT_FOUND';

/**
 * Test-only provider (demo mode; AppConfig refuses it in production). `mock_success_*` keys succeed
 * with the order's amount, `mock_fail_*` keys are declined. Confirmed payments are remembered in
 * memory so a webhook re-lookup (`fetchPayment`) works within the same process.
 */
export const createMockPaymentProvider = (): PaymentProvider => {
  const confirmed = new Map<string, ProviderPaymentSuccess>();

  return {
    kind: PaymentProviderType.MOCK,
    getClientConfig: () => ({ clientKey: null, mode: PaymentClientMode.MOCK }),
    confirm: async (input: ConfirmPaymentInput): Promise<ProviderPaymentResult> => {
      if (!input.paymentKey.startsWith(MOCK_SUCCESS_PREFIX)) {
        return { ok: false, code: MOCK_DECLINED_CODE, message: '테스트 결제 실패', transient: false };
      }

      const result: ProviderPaymentSuccess = {
        ok: true,
        orderId: input.orderId,
        paymentKey: input.paymentKey,
        amount: input.amount,
        currency: PRICE_CURRENCY,
        status: PaymentStatus.PAID,
      };

      confirmed.set(input.paymentKey, result);

      return result;
    },
    fetchPayment: async (paymentKey: string): Promise<ProviderPaymentResult> =>
      confirmed.get(paymentKey) ?? { ok: false, code: NOT_FOUND_CODE, message: '', transient: false },
  };
};

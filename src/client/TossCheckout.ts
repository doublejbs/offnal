import { type CreatePaymentResponse } from '@/domain/types/api/CreatePaymentResponse';

const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';
const SCRIPT_ID = 'toss-payments-sdk';

/** Minimal surface of the Toss Payments SDK v2 widgets API that this app uses. */
type TossWidgets = {
  setAmount: (amount: { currency: string; value: number }) => Promise<void>;
  renderPaymentMethods: (options: { selector: string; variantKey?: string }) => Promise<unknown>;
  renderAgreement: (options: { selector: string; variantKey?: string }) => Promise<unknown>;
  requestPayment: (options: {
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
  }) => Promise<void>;
};

type TossPaymentsFactory = (clientKey: string) => {
  widgets: (options: { customerKey: string }) => TossWidgets;
};

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory;
  }
}

export class TossUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TossUnavailableError';
  }
}

const loadSdk = (): Promise<TossPaymentsFactory> =>
  new Promise((resolve, reject) => {
    if (window.TossPayments) {
      resolve(window.TossPayments);

      return;
    }

    const existing = document.getElementById(SCRIPT_ID);
    const script = existing instanceof HTMLScriptElement ? existing : document.createElement('script');
    const handleLoad = () => {
      if (window.TossPayments) {
        resolve(window.TossPayments);
      } else {
        reject(new TossUnavailableError('결제 모듈을 불러오지 못했어요.'));
      }
    };
    const handleError = () => reject(new TossUnavailableError('결제 모듈을 불러오지 못했어요.'));

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = TOSS_SDK_URL;
      script.async = true;
      document.head.append(script);
    }
  });

export type TossCheckoutHandle = {
  requestPayment: () => Promise<void>;
};

/**
 * Loads the SDK, renders the payment method and agreement widgets into the given selectors and
 * returns a handle that redirects to the provider. Success is only ever decided by the server confirm.
 */
export const mountTossCheckout = async (
  payment: CreatePaymentResponse,
  selectors: { methods: string; agreement: string },
): Promise<TossCheckoutHandle> => {
  const { clientKey, customerKey, successUrl, failUrl } = payment.clientConfig;

  if (!clientKey) {
    throw new TossUnavailableError('결제 설정이 아직 준비되지 않았어요.');
  }

  const factory = await loadSdk();
  const widgets = factory(clientKey).widgets({ customerKey });

  await widgets.setAmount({ currency: payment.currency, value: payment.amount });
  await Promise.all([
    widgets.renderPaymentMethods({ selector: selectors.methods, variantKey: 'DEFAULT' }),
    widgets.renderAgreement({ selector: selectors.agreement, variantKey: 'AGREEMENT' }),
  ]);

  return {
    requestPayment: () =>
      widgets.requestPayment({
        orderId: payment.orderId,
        orderName: payment.orderName,
        successUrl,
        failUrl,
      }),
  };
};

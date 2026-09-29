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

const LOAD_TIMEOUT_MS = 15_000;
const LOAD_FAILED_MESSAGE = '결제 모듈을 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.';

/** One shared load per page; cleared on failure so a retry injects a fresh <script>. */
let sdkPromise: Promise<TossPaymentsFactory> | null = null;

const injectScript = (): Promise<TossPaymentsFactory> =>
  new Promise((resolve, reject) => {
    if (window.TossPayments) {
      resolve(window.TossPayments);

      return;
    }

    document.getElementById(SCRIPT_ID)?.remove();

    const script = document.createElement('script');
    const fail = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new TossUnavailableError(LOAD_FAILED_MESSAGE));
    };
    const timer = window.setTimeout(fail, LOAD_TIMEOUT_MS);

    script.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);

        if (window.TossPayments) {
          resolve(window.TossPayments);
        } else {
          fail();
        }
      },
      { once: true },
    );
    script.addEventListener('error', fail, { once: true });
    script.id = SCRIPT_ID;
    script.src = TOSS_SDK_URL;
    script.async = true;
    document.head.append(script);
  });

const loadSdk = (): Promise<TossPaymentsFactory> => {
  sdkPromise ??= injectScript().catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
};

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

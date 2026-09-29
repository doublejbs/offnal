import { z } from 'zod';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { PaymentClientMode } from '@/domain/enums/PaymentClientMode';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { ApiError } from '@/server/errors/ApiError';
import {
  type ConfirmPaymentInput,
  type PaymentProvider,
  type ProviderPaymentFailure,
  type ProviderPaymentResult,
} from '@/server/payment/PaymentProvider';

export const TOSS_API_BASE_URL = 'https://api.tosspayments.com';

const TEST_KEY_PREFIX = 'test_';
const ALREADY_PROCESSED_CODE = 'ALREADY_PROCESSED_PAYMENT';
const TIMEOUT_CODE = 'TIMEOUT';
const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
const INVALID_RESPONSE_CODE = 'INVALID_RESPONSE';
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR_MIN = 500;

/** Toss payment status → ours. Unknown and in-flight statuses stay pending (never granted). */
const STATUS_BY_TOSS_STATUS: Record<string, PaymentStatus> = {
  DONE: PaymentStatus.PAID,
  CANCELED: PaymentStatus.CANCELED,
  PARTIAL_CANCELED: PaymentStatus.CANCELED,
  ABORTED: PaymentStatus.FAILED,
  EXPIRED: PaymentStatus.FAILED,
};

const tossPaymentSchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  totalAmount: z.number(),
  currency: z.string().min(1),
  status: z.string().min(1),
});

const tossErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().default(''),
});

export type TossPaymentOptions = {
  clientKey: string | null;
  secretKey: string | null;
  timeoutMs: number;
};

type TossKeys = { clientKey: string; secretKey: string };

const requireKeys = (options: TossPaymentOptions): TossKeys => {
  if (!options.clientKey || !options.secretKey) {
    throw new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED, { message: '결제가 아직 설정되지 않았어요.' });
  }

  return { clientKey: options.clientKey, secretKey: options.secretKey };
};

const buildAuthorization = (secretKey: string): string =>
  `Basic ${Buffer.from(`${secretKey}:`, 'utf8').toString('base64')}`;

const toFailure = (code: string, message: string, transient: boolean): ProviderPaymentFailure => ({
  ok: false,
  code,
  message,
  transient,
});

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

const readJsonSafely = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const mapResponse = async (response: Response): Promise<ProviderPaymentResult> => {
  const body = await readJsonSafely(response);

  if (!response.ok) {
    const error = tossErrorSchema.safeParse(body);
    const transient = response.status === TOO_MANY_REQUESTS || response.status >= SERVER_ERROR_MIN;

    return error.success
      ? toFailure(error.data.code, error.data.message, transient)
      : toFailure(`HTTP_${response.status}`, '', transient);
  }

  const payment = tossPaymentSchema.safeParse(body);

  // A 200 we cannot read may still be a completed payment: transient, so it is never marked failed.
  if (!payment.success) {
    return toFailure(INVALID_RESPONSE_CODE, '', true);
  }

  return {
    ok: true,
    orderId: payment.data.orderId,
    paymentKey: payment.data.paymentKey,
    amount: payment.data.totalAmount,
    currency: payment.data.currency,
    status: STATUS_BY_TOSS_STATUS[payment.data.status] ?? PaymentStatus.PENDING,
  };
};

/**
 * Toss Payments core API (Spec §9). Secret keys only ever appear in the Authorization header;
 * nothing here logs requests, headers or keys.
 */
export const createTossPaymentProvider = (options: TossPaymentOptions): PaymentProvider => {
  const request = async (path: string, init: RequestInit): Promise<ProviderPaymentResult> => {
    const { secretKey } = requireKeys(options);
    const headers = new Headers(init.headers);

    headers.set('Authorization', buildAuthorization(secretKey));

    try {
      const response = await fetch(`${TOSS_API_BASE_URL}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(options.timeoutMs),
        cache: 'no-store',
      });

      return await mapResponse(response);
    } catch (error: unknown) {
      return isTimeoutError(error)
        ? toFailure(TIMEOUT_CODE, 'Toss request timed out', true)
        : toFailure(NETWORK_ERROR_CODE, 'Toss request failed', true);
    }
  };

  const fetchPayment = async (paymentKey: string): Promise<ProviderPaymentResult> =>
    request(`/v1/payments/${encodeURIComponent(paymentKey)}`, { method: 'GET' });

  return {
    kind: PaymentProviderType.TOSS,
    getClientConfig: () => {
      const { clientKey } = requireKeys(options);

      return {
        clientKey,
        mode: clientKey.startsWith(TEST_KEY_PREFIX) ? PaymentClientMode.TEST : PaymentClientMode.LIVE,
      };
    },
    confirm: async (input: ConfirmPaymentInput): Promise<ProviderPaymentResult> => {
      const result = await request('/v1/payments/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Same key → Toss replays the first result instead of charging again.
          'Idempotency-Key': `confirm-${input.orderId}-${input.paymentKey}`.slice(0, 300),
        },
        body: JSON.stringify({ paymentKey: input.paymentKey, orderId: input.orderId, amount: input.amount }),
      });

      // A concurrent/duplicate confirm: the payment's real state is what counts.
      if (!result.ok && result.code === ALREADY_PROCESSED_CODE) {
        return fetchPayment(input.paymentKey);
      }

      return result;
    },
    fetchPayment,
    fetchPaymentByOrderId: async (orderId: string): Promise<ProviderPaymentResult> =>
      request(`/v1/payments/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }),
  };
};

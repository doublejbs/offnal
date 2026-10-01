import { buildIcsUrl, buildSharedIcsUrl } from '@/client/IcsUrls';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type CandidatesResponse } from '@/domain/types/api/CandidatesResponse';
import { type ConfirmPaymentRequest } from '@/domain/types/api/ConfirmPaymentRequest';
import { type ConfirmPaymentResponse } from '@/domain/types/api/ConfirmPaymentResponse';
import { type CreatePaymentRequest } from '@/domain/types/api/CreatePaymentRequest';
import { type CreatePaymentResponse } from '@/domain/types/api/CreatePaymentResponse';
import { type CreateRecognitionResponse } from '@/domain/types/api/CreateRecognitionResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type EditPublishedMonthResponse } from '@/domain/types/api/EditPublishedMonthResponse';
import { type ExportDataResponse } from '@/domain/types/api/ExportDataResponse';
import { type ExtractRecognitionRequest } from '@/domain/types/api/ExtractRecognitionRequest';
import { type ExtractRecognitionResponse } from '@/domain/types/api/ExtractRecognitionResponse';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type PatchDraftRequest } from '@/domain/types/api/PatchDraftRequest';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { type UpdateShareRequest } from '@/domain/types/api/UpdateShareRequest';

const NETWORK_ERROR_MESSAGE = '네트워크 연결을 확인하고 다시 시도해 주세요.';
const UNKNOWN_ERROR_MESSAGE = '일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
const NOT_FOUND_MESSAGE = '요청한 내용을 찾을 수 없어요.';

/** Typed API failure. `status` 0 means the request never reached the server. */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode | null;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: ApiErrorCode | null, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const isApiClientError = (error: unknown): error is ApiClientError => error instanceof ApiClientError;

/** Korean message safe to show for any thrown value. */
export const getErrorMessage = (error: unknown): string =>
  isApiClientError(error) ? error.message : UNKNOWN_ERROR_MESSAGE;

const isApiErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.code === 'string';

const toApiClientError = async (response: Response): Promise<ApiClientError> => {
  const body: unknown = await response.json().catch(() => null);

  if (isApiErrorBody(body)) {
    return new ApiClientError(response.status, body.error.code, body.error.message, body.error.details);
  }

  if (response.status === 404) {
    return new ApiClientError(404, ApiErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE);
  }

  return new ApiClientError(response.status, null, UNKNOWN_ERROR_MESSAGE);
};

/** Low-level fetch: same-origin cookies, parsed error bodies, network failures as status 0. */
export const apiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  let response: Response;

  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    throw new ApiClientError(0, null, NETWORK_ERROR_MESSAGE);
  }

  if (!response.ok) {
    throw await toApiClientError(response);
  }

  return response;
};

/** JSON request through `apiFetch` (shared by the per-area API clients). */
export const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await apiFetch(path, init);

  return (await response.json()) as T;
};

export const getJson = <T>(path: string, signal?: AbortSignal): Promise<T> =>
  requestJson<T>(path, { signal });

export const sendJson = <T>(method: string, path: string, body?: unknown): Promise<T> =>
  requestJson<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const encode = encodeURIComponent;

export const getPublicConfig = (): Promise<PublicConfigResponse> => getJson('/api/config/public');

// Recognition
export const uploadRecognition = (file: Blob, filename: string): Promise<CreateRecognitionResponse> => {
  const form = new FormData();

  form.append('file', file, filename);

  return requestJson('/api/recognitions', { method: 'POST', body: form });
};

export const processRecognition = (id: string): Promise<RecognitionStatusResponse> =>
  sendJson('POST', `/api/recognitions/${encode(id)}/process`);

export const getRecognitionStatus = (id: string, signal?: AbortSignal): Promise<RecognitionStatusResponse> =>
  getJson(`/api/recognitions/${encode(id)}/status`, signal);

export const claimRecognition = (id: string): Promise<RecognitionStatusResponse> =>
  sendJson('POST', `/api/recognitions/${encode(id)}/claim`);

export const getCandidates = (id: string, signal?: AbortSignal): Promise<CandidatesResponse> =>
  getJson(`/api/recognitions/${encode(id)}/candidates`, signal);

export const getRecognitionSourceUrl = (id: string): string => `/api/recognitions/${encode(id)}/source`;

export const extractRecognition = (
  id: string,
  body: ExtractRecognitionRequest,
): Promise<ExtractRecognitionResponse> => sendJson('POST', `/api/recognitions/${encode(id)}/extract`, body);

// Drafts
export const getDraft = (id: string, signal?: AbortSignal): Promise<DraftResponse> =>
  getJson(`/api/drafts/${encode(id)}`, signal);

export const patchDraft = (id: string, body: PatchDraftRequest): Promise<DraftResponse> =>
  sendJson('PATCH', `/api/drafts/${encode(id)}`, body);

export const publishDraft = (id: string, revision: number): Promise<PublishDraftResponse> =>
  sendJson('POST', `/api/drafts/${encode(id)}/publish`, { revision });

export const discardDraft = (id: string): Promise<OkResponse> =>
  sendJson('DELETE', `/api/drafts/${encode(id)}`);

// Calendar
export const getCalendarSummary = (signal?: AbortSignal): Promise<CalendarSummaryResponse> =>
  getJson('/api/calendar', signal);

export const getCalendarMonth = (yearMonth: string, signal?: AbortSignal): Promise<CalendarMonthResponse> =>
  getJson(`/api/calendar/${encode(yearMonth)}`, signal);

export const deleteCalendarMonth = (yearMonth: string): Promise<OkResponse> =>
  sendJson('DELETE', `/api/calendar/${encode(yearMonth)}`);

export const editCalendarMonth = (yearMonth: string): Promise<EditPublishedMonthResponse> =>
  sendJson('POST', `/api/calendar/${encode(yearMonth)}/edit`);

export const getExportData = (yearMonth: string): Promise<ExportDataResponse> =>
  getJson(`/api/calendar/${encode(yearMonth)}/export-data`);

/** ICS file as a Blob (the caller triggers the download). */
export const downloadIcs = async (yearMonth: string, includeOff: boolean): Promise<Blob> => {
  const response = await apiFetch(buildIcsUrl(yearMonth, includeOff));

  return response.blob();
};

// Share
export const getShareSettings = (signal?: AbortSignal): Promise<ShareSettingsResponse> =>
  getJson('/api/calendar/share', signal);

export const updateShareSettings = (body: UpdateShareRequest): Promise<ShareSettingsResponse> =>
  sendJson('POST', '/api/calendar/share', body);

export const rotateShareLink = (): Promise<ShareSettingsResponse> =>
  sendJson('POST', '/api/calendar/share/rotate');

export const stopSharing = (): Promise<ShareSettingsResponse> => sendJson('DELETE', '/api/calendar/share');

export const getSharedCalendar = (
  token: string,
  month: string | null,
  signal?: AbortSignal,
): Promise<SharedCalendarResponse> =>
  getJson(`/api/shared/${encode(token)}${month ? `?month=${encode(month)}` : ''}`, signal);

/** Recipient's one-time ICS of a shared month as a Blob (the caller triggers the download). */
export const downloadSharedIcs = async (
  token: string,
  yearMonth: string,
  includeOff: boolean,
  signal?: AbortSignal,
): Promise<Blob> => {
  const response = await apiFetch(buildSharedIcsUrl(token, yearMonth, includeOff), {
    credentials: 'omit',
    signal,
  });

  return response.blob();
};

// Payments
export const createPayment = (body: CreatePaymentRequest): Promise<CreatePaymentResponse> =>
  sendJson('POST', '/api/payments', body);

export const confirmPayment = (body: ConfirmPaymentRequest): Promise<ConfirmPaymentResponse> =>
  sendJson('POST', '/api/payments/confirm', body);

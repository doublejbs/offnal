import { type AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { type LoginClickSource } from '@/domain/enums/LoginClickSource';
import { type ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';

export const CLIENT_EVENTS_PATH = '/api/events';

/**
 * A CORS-safelisted type: Chromium (and Android in-app WebViews) throws on a beacon Blob typed
 * application/json. The server parses the body as JSON whatever the type.
 */
const BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8';

/** What the page may report (the server allowlist, Spec §26.5). No ids, names or `inApp`: the server adds those it trusts. */
export type ClientEventPayload =
  | {
      event:
        | AnalyticsEvent.LANDING_UPLOAD_CLICKED
        | AnalyticsEvent.SAMPLE_STARTED
        | AnalyticsEvent.SAMPLE_COMPLETED
        | AnalyticsEvent.SAMPLE_CTA_CLICKED;
    }
  | { event: AnalyticsEvent.SHARE_LATER_CLICKED; properties: { method: ShareLaterMethod } }
  | { event: AnalyticsEvent.LOGIN_CLICKED; properties: { from: LoginClickSource } };

/** Browser transports (injectable for tests). */
export type ClientEventTransport = {
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetch?: (url: string, init: RequestInit) => Promise<unknown>;
};

const getBrowserTransport = (): ClientEventTransport => {
  if (typeof navigator === 'undefined') {
    return {};
  }

  return {
    sendBeacon:
      typeof navigator.sendBeacon === 'function' ? (url, data) => navigator.sendBeacon(url, data) : undefined,
    fetch: typeof fetch === 'function' ? (url, init) => fetch(url, init) : undefined,
  };
};

/**
 * Fire-and-forget usage event: `sendBeacon` (survives navigating away, e.g. the Kakao login link), else a
 * keepalive fetch. Never throws and never reports failure — measuring must not change the screen.
 */
export const sendClientEvent = (
  payload: ClientEventPayload,
  transport: ClientEventTransport = getBrowserTransport(),
): void => {
  try {
    const body = JSON.stringify(payload);

    try {
      if (transport.sendBeacon?.(CLIENT_EVENTS_PATH, new Blob([body], { type: BEACON_CONTENT_TYPE }))) {
        return;
      }
    } catch {
      // A blocked beacon falls through to fetch.
    }

    transport
      .fetch?.(CLIENT_EVENTS_PATH, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        credentials: 'same-origin',
      })
      .catch(() => undefined);
  } catch {
    // Never surface measurement failures.
  }
};

import { describe, expect, it, vi } from 'vitest';

import { CLIENT_EVENTS_PATH, sendClientEvent } from '@/client/ClientAnalytics';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { LoginClickSource } from '@/domain/enums/LoginClickSource';

const readBlob = async (blob: unknown): Promise<string> => (blob as Blob).text();

describe('sendClientEvent', () => {
  it('prefers sendBeacon with a JSON body', async () => {
    const sendBeacon = vi.fn(() => true);
    const fetch = vi.fn();

    sendClientEvent(
      { event: AnalyticsEvent.LOGIN_CLICKED, properties: { from: LoginClickSource.LANDING } },
      { sendBeacon, fetch },
    );

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    const [path, body] = sendBeacon.mock.calls[0] as unknown as [string, Blob];

    expect(path).toBe(CLIENT_EVENTS_PATH);
    expect(body.type).toBe('application/json');
    expect(JSON.parse(await readBlob(body))).toEqual({
      event: AnalyticsEvent.LOGIN_CLICKED,
      properties: { from: LoginClickSource.LANDING },
    });
  });

  it('falls back to a keepalive fetch when sendBeacon is missing or refuses', () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

    sendClientEvent({ event: AnalyticsEvent.LANDING_UPLOAD_CLICKED }, { sendBeacon: () => false, fetch });
    sendClientEvent({ event: AnalyticsEvent.LANDING_UPLOAD_CLICKED }, { fetch });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]).toEqual([
      CLIENT_EVENTS_PATH,
      expect.objectContaining({ method: 'POST', keepalive: true, credentials: 'same-origin' }),
    ]);
  });

  it('swallows every failure', async () => {
    const rejected = vi.fn(() => Promise.reject(new Error('offline')));

    expect(() =>
      sendClientEvent(
        { event: AnalyticsEvent.SAMPLE_STARTED },
        {
          sendBeacon: () => {
            throw new TypeError('blocked');
          },
          fetch: rejected,
        },
      ),
    ).not.toThrow();
    expect(() => sendClientEvent({ event: AnalyticsEvent.SAMPLE_STARTED }, {})).not.toThrow();
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});

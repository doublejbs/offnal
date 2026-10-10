import { describe, expect, it } from 'vitest';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { LoginClickSource } from '@/domain/enums/LoginClickSource';
import { ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';
import { CLIENT_ANALYTICS_EVENTS, parseClientEvent } from '@/server/analytics/ClientEventSchema';

describe('parseClientEvent (POST /api/events allowlist, Spec §26.5)', () => {
  it('allows exactly the client events', () => {
    expect([...CLIENT_ANALYTICS_EVENTS].sort()).toEqual(
      [
        AnalyticsEvent.LANDING_UPLOAD_CLICKED,
        AnalyticsEvent.SAMPLE_STARTED,
        AnalyticsEvent.SAMPLE_COMPLETED,
        AnalyticsEvent.SAMPLE_CTA_CLICKED,
        AnalyticsEvent.SHARE_LATER_CLICKED,
        AnalyticsEvent.LOGIN_CLICKED,
      ].sort(),
    );
  });

  it('accepts property-less events with or without an empty properties object', () => {
    expect(parseClientEvent({ event: AnalyticsEvent.LANDING_UPLOAD_CLICKED })).toEqual({
      event: AnalyticsEvent.LANDING_UPLOAD_CLICKED,
      properties: {},
    });
    expect(parseClientEvent({ event: AnalyticsEvent.SAMPLE_STARTED, properties: {} })).toEqual({
      event: AnalyticsEvent.SAMPLE_STARTED,
      properties: {},
    });
  });

  it('accepts the declared enum properties', () => {
    expect(
      parseClientEvent({
        event: AnalyticsEvent.SHARE_LATER_CLICKED,
        properties: { method: ShareLaterMethod.COPY },
      }),
    ).toEqual({ event: AnalyticsEvent.SHARE_LATER_CLICKED, properties: { method: ShareLaterMethod.COPY } });
    expect(
      parseClientEvent({ event: AnalyticsEvent.LOGIN_CLICKED, properties: { from: LoginClickSource.GATE } }),
    ).toEqual({ event: AnalyticsEvent.LOGIN_CLICKED, properties: { from: LoginClickSource.GATE } });
  });

  it('rejects server-only, unknown and malformed events', () => {
    for (const event of [
      AnalyticsEvent.LOGIN_FAILED,
      AnalyticsEvent.UPLOAD_STARTED,
      AnalyticsEvent.MONTH_PUBLISHED,
      'free_text',
      '',
      1,
      null,
    ]) {
      expect(parseClientEvent({ event })).toBeNull();
    }

    expect(parseClientEvent(null)).toBeNull();
    expect(parseClientEvent('landing_upload_clicked')).toBeNull();
    expect(parseClientEvent([AnalyticsEvent.SAMPLE_STARTED])).toBeNull();
  });

  it('rejects missing, wrong or extra properties (including client-sent ids and inApp)', () => {
    expect(parseClientEvent({ event: AnalyticsEvent.SHARE_LATER_CLICKED })).toBeNull();
    expect(
      parseClientEvent({ event: AnalyticsEvent.SHARE_LATER_CLICKED, properties: { method: 'email' } }),
    ).toBeNull();
    expect(
      parseClientEvent({ event: AnalyticsEvent.LOGIN_CLICKED, properties: { from: 'checkout' } }),
    ).toBeNull();
    expect(
      parseClientEvent({
        event: AnalyticsEvent.LOGIN_CLICKED,
        properties: { from: LoginClickSource.LANDING, name: '김간호' },
      }),
    ).toBeNull();
    expect(
      parseClientEvent({ event: AnalyticsEvent.SAMPLE_STARTED, properties: { inApp: true } }),
    ).toBeNull();
    expect(parseClientEvent({ event: AnalyticsEvent.SAMPLE_STARTED, properties: { count: 1 } })).toBeNull();
    expect(parseClientEvent({ event: AnalyticsEvent.SAMPLE_STARTED, actorUserId: 'u1' })).toBeNull();
  });
});

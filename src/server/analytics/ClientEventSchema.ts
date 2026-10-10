import { z } from 'zod';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { LoginClickSource } from '@/domain/enums/LoginClickSource';
import { ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';
import { type AnalyticsProperties } from '@/server/analytics/AnalyticsProperties';

/** Events the browser may report through POST /api/events (Spec §26.5). Everything else is server-only. */
export const CLIENT_ANALYTICS_EVENTS = [
  AnalyticsEvent.LANDING_UPLOAD_CLICKED,
  AnalyticsEvent.SAMPLE_STARTED,
  AnalyticsEvent.SAMPLE_COMPLETED,
  AnalyticsEvent.SAMPLE_CTA_CLICKED,
  AnalyticsEvent.SHARE_LATER_CLICKED,
  AnalyticsEvent.LOGIN_CLICKED,
] as const;

export type ClientAnalyticsEvent = (typeof CLIENT_ANALYTICS_EVENTS)[number];

export type ParsedClientEvent = {
  event: ClientAnalyticsEvent;
  properties: AnalyticsProperties;
};

const withoutProperties = (event: ClientAnalyticsEvent) =>
  z.strictObject({ event: z.literal(event), properties: z.strictObject({}).optional() });

/** Strict objects: an extra key (an id, a name, a client-sent `inApp`) rejects the whole event. */
const clientEventSchema = z.discriminatedUnion('event', [
  withoutProperties(AnalyticsEvent.LANDING_UPLOAD_CLICKED),
  withoutProperties(AnalyticsEvent.SAMPLE_STARTED),
  withoutProperties(AnalyticsEvent.SAMPLE_COMPLETED),
  withoutProperties(AnalyticsEvent.SAMPLE_CTA_CLICKED),
  z.strictObject({
    event: z.literal(AnalyticsEvent.SHARE_LATER_CLICKED),
    properties: z.strictObject({ method: z.enum(ShareLaterMethod) }),
  }),
  z.strictObject({
    event: z.literal(AnalyticsEvent.LOGIN_CLICKED),
    properties: z.strictObject({ from: z.enum(LoginClickSource) }),
  }),
]);

/** The allowed client event with its declared properties, or null for anything else. Never throws. */
export const parseClientEvent = (body: unknown): ParsedClientEvent | null => {
  const parsed = clientEventSchema.safeParse(body);

  if (!parsed.success) {
    return null;
  }

  return { event: parsed.data.event, properties: parsed.data.properties ?? {} };
};

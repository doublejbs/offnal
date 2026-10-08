import 'server-only';

import { createHmac } from 'node:crypto';

import { type AnalyticsSubjectKind } from '@/domain/enums/AnalyticsSubjectKind';

/** Hex characters kept from the HMAC (128 bits: collision-free at this scale, not reversible). */
export const ANALYTICS_KEY_LENGTH = 32;

const ACTOR_NAMESPACE = 'user';

export type AnalyticsSubject = {
  kind: AnalyticsSubjectKind;
  id: string;
};

/** HMAC-SHA256(secret, `namespace:id`), first 32 hex chars (Spec §23.1). */
const buildPseudonymousKey = (secret: string, namespace: string, id: string): string =>
  createHmac('sha256', secret).update(`${namespace}:${id}`).digest('hex').slice(0, ANALYTICS_KEY_LENGTH);

/** `actor_key`: the user, never joinable with `users.id` without APP_SECRET. */
export const buildActorKey = (userId: string, secret: string): string =>
  buildPseudonymousKey(secret, ACTOR_NAMESPACE, userId);

/** `subject_key`: a job, calendar or team, namespaced by kind so equal ids never collide across kinds. */
export const buildSubjectKey = (subject: AnalyticsSubject, secret: string): string =>
  buildPseudonymousKey(secret, subject.kind, subject.id);

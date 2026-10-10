import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import { isSocialInAppUserAgent } from '@/server/analytics/InAppUserAgent';

type HeaderReader = { get: (name: string) => string | null };

type AnalyticsRequestFacts = {
  /** Instagram/Facebook in-app browser, from the request User-Agent (Spec §26.5). */
  inApp: boolean;
};

const scope = new AsyncLocalStorage<AnalyticsRequestFacts>();

/**
 * Runs a route handler with the request facts every `track` call inside it adds to its event. Only the
 * derived boolean is kept: the User-Agent string never leaves this function.
 */
export const runWithAnalyticsRequest = <T>(headers: HeaderReader, handler: () => T): T =>
  scope.run({ inApp: isSocialInAppUserAgent(headers.get('user-agent')) }, handler);

/** Facts of the current request, or null outside a route (scripts, cron-less tests). */
export const readAnalyticsRequestFacts = (): AnalyticsRequestFacts | null => scope.getStore() ?? null;

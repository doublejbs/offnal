import 'server-only';

import { after } from 'next/server';

import { OcrMode } from '@/domain/enums/OcrMode';
import { getAppConfig } from '@/server/config/AppConfig';
import { describeError } from '@/server/errors/ErrorName';
import { EXTRACT_MAX_DURATION_SECONDS } from '@/server/services/ExtractRouteLimits';
import {
  OCR_SHADOW_DRAFT_PARAM,
  OCR_SHADOW_JOB_PARAM,
  OCR_SHADOW_ROUTE_PATH,
  VERCEL_PROTECTION_BYPASS_HEADER,
} from '@/server/services/OcrShadowRouteLimits';

const MS_PER_SECOND = 1000;

/** Kept free at the end of the extract invocation when waiting for the internal route. */
export const OCR_CALL_SAFETY_MS = 5_000;

type RawEnv = Record<string, string | undefined>;

type ShadowGateConfig = {
  ocrMode: OcrMode;
  ocrShadowSampleRate: number;
};

type ShadowCallConfig = ShadowGateConfig & {
  /** Null: the internal route is disabled, nothing is called. */
  ocrInternalSecret: string | null;
  appUrl: string;
};

/** What the extract hands over: ids to look the draft up, and the photo bytes it already holds. */
export type OcrShadowRequestInput = {
  draftId: string;
  jobId: string;
  sourceBytes: Buffer;
};

export type OcrShadowScheduleOptions = {
  config: ShadowCallConfig;
  random: () => number;
  /** Runs the task after the response (`after` from next/server). */
  schedule: (task: () => Promise<void>) => void;
  fetch: typeof fetch;
  /** Wall clock in epoch ms (default `Date.now`), compared with `requestStartedAt`. */
  now: () => number;
  /** Platform variables (`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, bypass secret); default `process.env`. */
  env: RawEnv;
};

const buildDefaultOptions = (): OcrShadowScheduleOptions => ({
  config: getAppConfig(),
  random: Math.random,
  schedule: after,
  fetch: (input, init) => fetch(input, init),
  now: Date.now,
  env: process.env,
});

type ShadowGlobal = typeof globalThis & {
  __offnalOcrShadowOverrides?: Partial<OcrShadowScheduleOptions>;
};

const shadowGlobal = globalThis as ShadowGlobal;

/** Replaces scheduling dependencies (null restores the defaults). Tests only. */
export const setOcrShadowOverridesForTesting = (
  overrides: Partial<OcrShadowScheduleOptions> | null,
): void => {
  shadowGlobal.__offnalOcrShadowOverrides = overrides ?? undefined;
};

/** Shadow mode on and this extract sampled (rate 1 = every extract, 0 = none). */
export const shouldRunOcrShadow = (config: ShadowGateConfig, random: () => number): boolean =>
  config.ocrMode === OcrMode.SHADOW && random() < config.ocrShadowSampleRate;

export type OcrShadowTarget = {
  /** Origin the internal route is called on. */
  origin: string;
  /** Extra headers (the Deployment Protection bypass on protected Vercel URLs). */
  headers: Record<string, string>;
};

/**
 * Where the extract calls the internal route (Spec §22-11). On Vercel each deployment calls itself on its
 * own deployment URL (`VERCEL_URL`), so a preview never reaches production and production runs the same
 * build: with Deployment Protection that URL needs the automation bypass secret, which is sent when the
 * platform provides it. Production without that secret uses APP_URL (the production domain is not
 * protected). Elsewhere (local) APP_URL.
 */
export const resolveOcrShadowTarget = (env: RawEnv, appUrl: string): OcrShadowTarget => {
  const deploymentHost = env.VERCEL ? env.VERCEL_URL?.trim() : undefined;
  const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

  if (!deploymentHost) {
    return { origin: appUrl, headers: {} };
  }

  if (bypassSecret) {
    return {
      origin: `https://${deploymentHost}`,
      headers: { [VERCEL_PROTECTION_BYPASS_HEADER]: bypassSecret },
    };
  }

  if (env.VERCEL_ENV === 'production') {
    return { origin: appUrl, headers: {} };
  }

  return { origin: `https://${deploymentHost}`, headers: {} };
};

/** How long `after()` may wait for the internal route: what is left of the extract maxDuration. */
export const resolveOcrCallTimeout = (requestStartedAt: number, now: number): number =>
  EXTRACT_MAX_DURATION_SECONDS * MS_PER_SECOND - Math.max(0, now - requestStartedAt) - OCR_CALL_SAFETY_MS;

const buildRouteUrl = (origin: string, input: OcrShadowRequestInput): string => {
  const url = new URL(OCR_SHADOW_ROUTE_PATH, origin);

  url.searchParams.set(OCR_SHADOW_DRAFT_PARAM, input.draftId);
  url.searchParams.set(OCR_SHADOW_JOB_PARAM, input.jobId);

  return url.toString();
};

/** Calls the internal route and waits for it; every failure is logged by class name or status only. */
const callInternalRoute = async (
  input: OcrShadowRequestInput,
  resolved: OcrShadowScheduleOptions,
  secret: string,
  requestStartedAt: number,
): Promise<void> => {
  const timeoutMs = resolveOcrCallTimeout(requestStartedAt, resolved.now());

  if (timeoutMs <= 0) {
    console.warn('[ocr-shadow] no time left to call the OCR route');

    return;
  }

  const target = resolveOcrShadowTarget(resolved.env, resolved.config.appUrl);
  const response = await resolved.fetch(buildRouteUrl(target.origin, input), {
    method: 'POST',
    headers: {
      ...target.headers,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(input.sourceBytes),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });

  // The body is a small status JSON; drain it so the connection is released.
  await response.arrayBuffer().catch(() => undefined);

  if (!response.ok) {
    console.warn('[ocr-shadow] OCR route refused', { status: response.status });
  }
};

/**
 * After a new row draft (Spec §22-11): if shadow mode is on and this extract is sampled, queues a call to
 * the internal OCR route after the response, sending the photo bytes already in memory. Returns whether
 * a call was queued. Never throws and never changes the response: the call's failures and timeouts are
 * swallowed (the OCR route records its own outcome rows). `requestStartedAt` (epoch ms) bounds the wait.
 */
export const scheduleOcrShadow = (
  input: OcrShadowRequestInput,
  requestStartedAt: number,
  options: Partial<OcrShadowScheduleOptions> = {},
): boolean => {
  try {
    const resolved = { ...buildDefaultOptions(), ...shadowGlobal.__offnalOcrShadowOverrides, ...options };

    if (!shouldRunOcrShadow(resolved.config, resolved.random)) {
      return false;
    }

    const secret = resolved.config.ocrInternalSecret;

    if (!secret) {
      console.warn('[ocr-shadow] OCR_INTERNAL_SECRET is not set');

      return false;
    }

    resolved.schedule(async () => {
      try {
        await callInternalRoute(input, resolved, secret, requestStartedAt);
      } catch (error: unknown) {
        console.warn('[ocr-shadow] OCR route call failed', { name: describeError(error) });
      }
    });

    return true;
  } catch (error: unknown) {
    console.warn('[ocr-shadow] schedule failed', { name: describeError(error) });

    return false;
  }
};

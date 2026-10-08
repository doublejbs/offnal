import { afterEach, describe, expect, it, vi } from 'vitest';

import { OcrMode } from '@/domain/enums/OcrMode';
import { maxDuration } from '@/app/api/recognitions/[id]/extract/route';
import { EXTRACT_MAX_DURATION_SECONDS } from '@/server/services/ExtractRouteLimits';
import { OCR_SHADOW_ROUTE_PATH } from '@/server/services/OcrShadowRouteLimits';
import {
  OCR_ACK_TIMEOUT_MS,
  OCR_CALL_SAFETY_MS,
  type OcrShadowScheduleOptions,
  resolveOcrCallTimeout,
  resolveOcrShadowTarget,
  scheduleOcrShadow,
  shouldRunOcrShadow,
} from '@/server/services/OcrShadowScheduler';
import { resolveOcrPoolSize } from '@/server/vision/ocr/OcrServiceEngine';

const SECRET = 's'.repeat(32);
const APP_URL = 'https://offnal.example';
const INPUT = {
  draftId: '00000000-0000-4000-8000-0000000000d1',
  jobId: '00000000-0000-4000-8000-000000000001',
  sourceBytes: Buffer.from('jpeg-bytes'),
};
const SHADOW_CONFIG = {
  ocrMode: OcrMode.SHADOW,
  ocrShadowSampleRate: 1,
  ocrInternalSecret: SECRET,
  appUrl: APP_URL,
};
const STARTED_AT = 1_000_000;

type Task = () => Promise<void>;

const okFetch = () => vi.fn<typeof fetch>(async () => new Response('{"accepted":true}', { status: 202 }));

const buildOptions = (overrides: Partial<OcrShadowScheduleOptions> = {}) => {
  const tasks: Task[] = [];
  const options: Partial<OcrShadowScheduleOptions> = {
    config: SHADOW_CONFIG,
    random: () => 0,
    schedule: (task) => tasks.push(task),
    fetch: okFetch(),
    now: () => STARTED_AT,
    env: {},
    ...overrides,
  };

  return { tasks, options };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow OCR gate', () => {
  it('runs only in shadow mode and only for the sampled share', () => {
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.OFF, ocrShadowSampleRate: 1 }, () => 0)).toBe(false);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 1 }, () => 0.999)).toBe(true);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0 }, () => 0)).toBe(false);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.3 }, () => 0.29)).toBe(true);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.3 }, () => 0.3)).toBe(false);
  });

  it('queues nothing when off, not sampled or without a secret, and never throws when scheduling fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const off = buildOptions({ config: { ...SHADOW_CONFIG, ocrMode: OcrMode.OFF } });
    const unsampled = buildOptions({
      config: { ...SHADOW_CONFIG, ocrShadowSampleRate: 0.5 },
      random: () => 0.9,
    });
    const noSecret = buildOptions({ config: { ...SHADOW_CONFIG, ocrInternalSecret: null } });

    expect(scheduleOcrShadow(INPUT, STARTED_AT, off.options)).toBe(false);
    expect(scheduleOcrShadow(INPUT, STARTED_AT, unsampled.options)).toBe(false);
    expect(scheduleOcrShadow(INPUT, STARTED_AT, noSecret.options)).toBe(false);
    expect([...off.tasks, ...unsampled.tasks, ...noSecret.tasks]).toEqual([]);

    expect(
      scheduleOcrShadow(INPUT, STARTED_AT, {
        ...buildOptions().options,
        schedule: () => {
          throw new Error('outside a request scope');
        },
      }),
    ).toBe(false);
    expect(
      scheduleOcrShadow(INPUT, STARTED_AT, {
        ...buildOptions().options,
        random: () => {
          throw new Error('broken random');
        },
      }),
    ).toBe(false);
  });

  it('uses one worker per language on Vercel', () => {
    expect(resolveOcrPoolSize({ VERCEL: '1' })).toBe(1);
    expect(resolveOcrPoolSize({})).toBeGreaterThan(1);
  });
});

describe('shadow OCR call to the internal route', () => {
  it('posts the photo bytes with the secret and the draft and job ids, after the response', async () => {
    const fetchMock = okFetch();
    const { tasks, options } = buildOptions({ fetch: fetchMock });

    expect(scheduleOcrShadow(INPUT, STARTED_AT, options)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await tasks[0]!();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    const headers = new Headers(init?.headers);

    expect(parsed.origin).toBe(APP_URL);
    expect(parsed.pathname).toBe(OCR_SHADOW_ROUTE_PATH);
    expect(parsed.searchParams.get('draftId')).toBe(INPUT.draftId);
    expect(parsed.searchParams.get('jobId')).toBe(INPUT.jobId);
    expect(init?.method).toBe('POST');
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET}`);
    expect(headers.get('content-type')).toBe('application/octet-stream');
    expect(Buffer.from(init?.body as Uint8Array).equals(INPUT.sourceBytes)).toBe(true);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('swallows a failed call, a refused call and a hanging call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rejecting = buildOptions({
      fetch: vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('x'))),
    });
    const refused = buildOptions({
      fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })),
    });

    scheduleOcrShadow(INPUT, STARTED_AT, rejecting.options);
    scheduleOcrShadow(INPUT, STARTED_AT, refused.options);

    await expect(rejecting.tasks[0]!()).resolves.toBeUndefined();
    await expect(refused.tasks[0]!()).resolves.toBeUndefined();

    // A call that never answers is aborted by its signal once the extract budget is spent.
    const hanging = buildOptions({
      fetch: vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
      now: () => STARTED_AT + EXTRACT_MAX_DURATION_SECONDS * 1000 - OCR_CALL_SAFETY_MS - 20,
    });

    scheduleOcrShadow(INPUT, STARTED_AT, hanging.options);
    await expect(hanging.tasks[0]!()).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });

  it('skips the call when the extract budget is already spent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const fetchMock = okFetch();
    const { tasks, options } = buildOptions({
      fetch: fetchMock,
      now: () => STARTED_AT + EXTRACT_MAX_DURATION_SECONDS * 1000,
    });

    scheduleOcrShadow(INPUT, STARTED_AT, options);
    await tasks[0]!();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits only for the acknowledgement, and never past the extract maxDuration', () => {
    expect(maxDuration).toBe(EXTRACT_MAX_DURATION_SECONDS);
    expect(resolveOcrCallTimeout(STARTED_AT, STARTED_AT + 40_000)).toBe(OCR_ACK_TIMEOUT_MS);

    const lateStart = STARTED_AT + EXTRACT_MAX_DURATION_SECONDS * 1000 - OCR_CALL_SAFETY_MS - 3_000;

    expect(resolveOcrCallTimeout(STARTED_AT, lateStart)).toBe(3_000);
  });

  it('calls its own deployment on Vercel and APP_URL elsewhere', () => {
    expect(resolveOcrShadowTarget({}, APP_URL)).toEqual({ origin: APP_URL, headers: {} });
    expect(resolveOcrShadowTarget({ VERCEL_URL: 'ignored.vercel.app' }, APP_URL)).toEqual({
      origin: APP_URL,
      headers: {},
    });
    expect(
      resolveOcrShadowTarget(
        { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'offnal-abc.vercel.app' },
        APP_URL,
      ),
    ).toEqual({ origin: 'https://offnal-abc.vercel.app', headers: {} });
    expect(
      resolveOcrShadowTarget(
        {
          VERCEL: '1',
          VERCEL_ENV: 'production',
          VERCEL_URL: 'offnal-abc.vercel.app',
          VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass',
        },
        APP_URL,
      ),
    ).toEqual({
      origin: 'https://offnal-abc.vercel.app',
      headers: { 'x-vercel-protection-bypass': 'bypass' },
    });
    // Production deployment URLs are protected; without a bypass secret the production domain is used.
    expect(
      resolveOcrShadowTarget(
        { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'offnal-abc.vercel.app' },
        APP_URL,
      ),
    ).toEqual({ origin: APP_URL, headers: {} });
  });
});

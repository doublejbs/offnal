import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { OcrMode } from '@/domain/enums/OcrMode';
import { scheduleOcrShadow, shouldRunOcrShadow } from '@/server/services/OcrShadowScheduler';
import { resolveOcrCacheDir, resolveOcrPoolSize } from '@/server/vision/ocr/OcrServiceEngine';
import { type Db } from '@/server/db/Database';

import { buildAiSchedule, MIXED_AI_CODES, SHADOW_MONTH, SHADOW_NAME } from './support/OcrShadowFixture';

const INPUT = {
  jobId: '00000000-0000-4000-8000-000000000001',
  sourceBytes: Buffer.from('jpeg'),
  name: SHADOW_NAME,
  yearMonth: SHADOW_MONTH,
  aiSchedule: buildAiSchedule(MIXED_AI_CODES),
};
const FAKE_DB = {} as Db;

describe('shadow OCR gate', () => {
  it('runs only in shadow mode and only for the sampled share', () => {
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.OFF, ocrShadowSampleRate: 1 }, () => 0)).toBe(false);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 1 }, () => 0.999)).toBe(true);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0 }, () => 0)).toBe(false);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.3 }, () => 0.29)).toBe(true);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.3 }, () => 0.3)).toBe(false);
  });

  it('schedules nothing when off or not sampled, and never throws when scheduling fails', () => {
    const schedule = vi.fn();

    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, {
        config: { ocrMode: OcrMode.OFF, ocrShadowSampleRate: 1 },
        schedule,
      }),
    ).toBe(false);
    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, {
        config: { ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.5 },
        random: () => 0.9,
        schedule,
      }),
    ).toBe(false);
    expect(schedule).not.toHaveBeenCalled();

    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, {
        config: { ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 1 },
        schedule: () => {
          throw new Error('outside a request scope');
        },
      }),
    ).toBe(false);
    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, {
        config: { ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 1 },
        schedule,
      }),
    ).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('caches language data in the temp dir with one worker per language on Vercel', () => {
    expect(resolveOcrCacheDir({ VERCEL: '1' })).toBe(path.join(tmpdir(), 'offnal-ocr'));
    expect(resolveOcrCacheDir({})).toBe(path.join('.data', 'ocr'));
    expect(resolveOcrPoolSize({ VERCEL: '1' })).toBe(1);
    expect(resolveOcrPoolSize({})).toBeGreaterThan(1);
  });
});

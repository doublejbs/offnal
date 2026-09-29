import { describe, expect, it } from 'vitest';

import { fitWithinLongEdge, MAX_LONG_EDGE, planEncodingAttempts } from '@/client/ImageDownscaler';

describe('ImageDownscaler', () => {
  it('limits the long edge to 2576px while keeping the aspect ratio', () => {
    expect(MAX_LONG_EDGE).toBe(2576);
    expect(fitWithinLongEdge(4032, 3024, MAX_LONG_EDGE)).toEqual({ width: 2576, height: 1932 });
    expect(fitWithinLongEdge(3024, 4032, MAX_LONG_EDGE)).toEqual({ width: 1932, height: 2576 });
  });

  it('never upscales small images', () => {
    expect(fitWithinLongEdge(1200, 900, MAX_LONG_EDGE)).toEqual({ width: 1200, height: 900 });
  });

  it('tries quality 0.85 at the capped size first, then lower quality, then smaller sizes', () => {
    const attempts = planEncodingAttempts(4032, 3024);

    expect(attempts[0]).toEqual({ width: 2576, height: 1932, quality: 0.85 });
    expect(attempts.slice(0, 4).map((attempt) => attempt.quality)).toEqual([0.85, 0.75, 0.65, 0.55]);
    expect(attempts[4]).toMatchObject({ width: 2061, quality: 0.85 });

    const longEdges = attempts.map((attempt) => Math.max(attempt.width, attempt.height));

    expect(longEdges.every((edge, index) => index === 0 || edge <= (longEdges[index - 1] ?? edge))).toBe(
      true,
    );
    expect(Math.min(...longEdges)).toBe(1024);
  });

  it('keeps small screenshots at their own size (no resize steps below it)', () => {
    const attempts = planEncodingAttempts(900, 600);

    expect(attempts).toHaveLength(4);
    expect(attempts.every((attempt) => attempt.width === 900 && attempt.height === 600)).toBe(true);
  });
});

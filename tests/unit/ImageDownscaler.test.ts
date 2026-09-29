import { describe, expect, it } from 'vitest';

import { fitWithinLongEdge, MAX_LONG_EDGE } from '@/client/ImageDownscaler';

describe('ImageDownscaler', () => {
  it('limits the long edge to 2576px while keeping the aspect ratio', () => {
    expect(MAX_LONG_EDGE).toBe(2576);
    expect(fitWithinLongEdge(4032, 3024, MAX_LONG_EDGE)).toEqual({ width: 2576, height: 1932 });
    expect(fitWithinLongEdge(3024, 4032, MAX_LONG_EDGE)).toEqual({ width: 1932, height: 2576 });
  });

  it('never upscales small images', () => {
    expect(fitWithinLongEdge(1200, 900, MAX_LONG_EDGE)).toEqual({ width: 1200, height: 900 });
  });
});

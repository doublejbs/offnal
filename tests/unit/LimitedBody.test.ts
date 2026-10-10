import { describe, expect, it } from 'vitest';

import { readLimitedText } from '@/server/http/LimitedBody';

/** Spec §26.5: /api/events stops reading a body past its limit instead of buffering it whole. */

const encoder = new TextEncoder();

/** An endless stream of 256-byte chunks that counts how many were pulled and whether it was cancelled. */
const endlessStream = () => {
  const stats = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      stats.pulled += 1;
      controller.enqueue(encoder.encode('x'.repeat(256)));
    },
    cancel: () => {
      stats.cancelled = true;
    },
  });

  return { stream, stats };
};

describe('readLimitedText', () => {
  it('returns the UTF-8 text of a body within the limit', async () => {
    const body = new Response('{"event":"sample_started","이름":"없음"}').body;

    expect(await readLimitedText(body, 1024)).toBe('{"event":"sample_started","이름":"없음"}');
  });

  it('returns an empty string without a body', async () => {
    expect(await readLimitedText(null, 1024)).toBe('');
  });

  it('counts bytes, not characters', async () => {
    // 400 Hangul syllables = 1200 bytes.
    expect(await readLimitedText(new Response('가'.repeat(400)).body, 1024)).toBeNull();
    expect(await readLimitedText(new Response('x'.repeat(1024)).body, 1024)).toBe('x'.repeat(1024));
  });

  it('stops pulling and cancels the stream once the limit is passed', async () => {
    const { stream, stats } = endlessStream();

    expect(await readLimitedText(stream, 1024)).toBeNull();
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(6);
  });
});

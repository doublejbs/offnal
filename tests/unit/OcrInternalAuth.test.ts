import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/internal/ocr-shadow/route';
import { resetAppConfigForTesting } from '@/server/config/AppConfig';
import { isOcrInternalAuthorized } from '@/server/services/OcrShadowInternalService';

const SECRET = 'internal-secret-internal-secret-0123';
const ROUTE_URL = 'http://localhost:3100/api/internal/ocr-shadow?probe=1';

const buildRequest = (authorization?: string): NextRequest =>
  new NextRequest(ROUTE_URL, {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
    body: new Uint8Array(),
  });

const setSecret = (secret: string | undefined): void => {
  if (secret === undefined) {
    delete process.env.OCR_INTERNAL_SECRET;
  } else {
    process.env.OCR_INTERNAL_SECRET = secret;
  }

  resetAppConfigForTesting();
};

beforeEach(() => {
  setSecret(SECRET);
});

afterEach(() => {
  setSecret(undefined);
});

describe('internal OCR route authentication', () => {
  it('compares the bearer secret and refuses everything without a configured secret', () => {
    expect(isOcrInternalAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isOcrInternalAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isOcrInternalAuthorized(SECRET, SECRET)).toBe(false);
    expect(isOcrInternalAuthorized(null, SECRET)).toBe(false);
    expect(isOcrInternalAuthorized('Bearer ', null)).toBe(false);
    expect(isOcrInternalAuthorized('Bearer ', '')).toBe(false);
  });

  it.each([
    ['a missing header', undefined],
    ['a wrong secret', 'Bearer wrong-secret'],
    ['a non-bearer scheme', `Basic ${SECRET}`],
  ])('answers a bare 404 for %s', async (_label, authorization) => {
    const response = await POST(buildRequest(authorization));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('answers 404 with the right secret when no secret is configured', async () => {
    setSecret(undefined);

    const response = await POST(buildRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(404);
  });

  it('answers 404 when the configuration is invalid (never a 500 that reveals the route)', async () => {
    process.env.OCR_TIMEOUT_MS = 'not-a-number';
    resetAppConfigForTesting();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const response = await POST(buildRequest(`Bearer ${SECRET}`));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
    } finally {
      delete process.env.OCR_TIMEOUT_MS;
      vi.restoreAllMocks();
    }
  });

  it('gets past authentication with the right secret', async () => {
    // The empty body is then refused as invalid input, not hidden as 404.
    const response = await POST(buildRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(400);
  });

  it('hides the route from other methods', async () => {
    expect((await GET()).status).toBe(404);
  });
});

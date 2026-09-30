type HeaderReader = { get: (name: string) => string | null };

/**
 * Client IP for rate limiting: first hop of `x-forwarded-for`, then `x-real-ip`, else 'unknown'.
 * Assumes a trusted proxy that overwrites these headers (Vercel does); behind an untrusted proxy
 * clients could spoof them. README documents this assumption.
 */
export const getClientIpFromHeaders = (headers: HeaderReader): string =>
  headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';

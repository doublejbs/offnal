/**
 * Headers for everything a share link exposes (GET /api/shared/:token and the /s/:token page via
 * next.config.ts). No caching so a rotated/disabled link stops working immediately; no indexing; no
 * Referer so the token never leaks to other sites. `noindex` is not access control.
 */
export const PUBLIC_SHARE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

/** Applies PUBLIC_SHARE_HEADERS to every response of the handler, errors included. */
export const withPublicShareHeaders =
  <TArgs extends unknown[]>(handler: (...args: TArgs) => Promise<Response>) =>
  async (...args: TArgs): Promise<Response> => {
    const response = await handler(...args);

    for (const [name, value] of Object.entries(PUBLIC_SHARE_HEADERS)) {
      response.headers.set(name, value);
    }

    return response;
  };

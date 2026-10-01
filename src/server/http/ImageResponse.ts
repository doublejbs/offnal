import 'server-only';

import { NO_STORE } from '@/server/http/RouteHelpers';

/** An original photo for its authorized viewer only: never cached, never sniffed, shown inline. */
export const privateImageResponse = (bytes: Buffer, mime: string): Response => {
  // Zero-copy view of the Buffer (BodyInit requires an ArrayBuffer-backed view).
  const body = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.length),
      'Cache-Control': `private, ${NO_STORE}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
};

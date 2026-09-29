import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { NO_STORE } from '@/server/http/RouteHelpers';
import { readSourceImage } from '@/server/services/RecognitionExtractService';

export const runtime = 'nodejs';

/** Original photo for the logged-in owner only; never cached, never a public URL. */
export const GET = apiRoute<IdParams>({ mutating: false }, async ({ db, context, params }) => {
  const source = await readSourceImage(db, context, params.id);

  // Zero-copy view of the Buffer (BodyInit requires an ArrayBuffer-backed view).
  const body = new Uint8Array(
    source.bytes.buffer as ArrayBuffer,
    source.bytes.byteOffset,
    source.bytes.byteLength,
  );

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': source.mime,
      'Content-Length': String(source.bytes.length),
      'Cache-Control': `private, ${NO_STORE}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
});

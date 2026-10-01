import { apiRoute, type IdParams } from '@/server/http/ApiRoute';
import { privateImageResponse } from '@/server/http/ImageResponse';
import { readSourceImage } from '@/server/services/RecognitionExtractService';

export const runtime = 'nodejs';

/** Original photo for the logged-in owner only; never cached, never a public URL. */
export const GET = apiRoute<IdParams>({ mutating: false }, async ({ db, context, params }) => {
  const source = await readSourceImage(db, context, params.id);

  return privateImageResponse(source.bytes, source.mime);
});

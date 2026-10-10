import 'server-only';

/**
 * Reads a request body as UTF-8 text, at most `maxBytes`: past the limit it cancels the stream and returns
 * null, so an oversized body (with or without Content-Length) is never buffered whole.
 */
export const readLimitedText = async (
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> => {
  if (!body) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);

        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
};

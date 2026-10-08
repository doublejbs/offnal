/** Error class names are short identifiers; anything longer is cut (never a message). */
const MAX_ERROR_NAME_LENGTH = 64;

/** Error class name for logs (never the message, which may quote user data). */
export const describeError = (error: unknown): string =>
  (error instanceof Error ? error.name : typeof error).slice(0, MAX_ERROR_NAME_LENGTH);

const UNIQUE_VIOLATION = '23505';

/** Walks the `cause` chain (drizzle wraps driver errors) looking for a Postgres SQLSTATE. */
export const getSqlState = (error: unknown): string | undefined => {
  let current: unknown = error;

  while (current instanceof Error) {
    const code = (current as Error & { code?: unknown }).code;

    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }

    current = current.cause;
  }

  return undefined;
};

export const isUniqueViolation = (error: unknown): boolean => getSqlState(error) === UNIQUE_VIOLATION;

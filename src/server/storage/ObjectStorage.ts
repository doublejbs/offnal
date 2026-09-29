/** Private object storage for uploaded source photos. Never issues public URLs. */
export type ObjectStorage = {
  put: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
  /** Returns null when the object does not exist. */
  get: (key: string) => Promise<Buffer | null>;
  /** No-op when the object does not exist. */
  delete: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
};

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;

/** Keys are app-generated (`sources/{uuid}`); anything path-like beyond that is rejected. */
export const assertValidObjectKey = (key: string): void => {
  if (!KEY_PATTERN.test(key) || key.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error('Invalid object key');
  }
};

export const buildSourceObjectKey = (jobId: string): string => `sources/${jobId}`;

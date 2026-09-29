import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertValidObjectKey, type ObjectStorage } from '@/server/storage/ObjectStorage';

const isMissingFileError = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 'ENOENT';

/** Development storage under LOCAL_STORAGE_DIR. Keys are validated and resolved inside the root only. */
export const createLocalObjectStorage = (rootDir: string): ObjectStorage => {
  // Runtime-configured dev directory: exclude it from output file tracing.
  const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), rootDir);

  const resolveKey = (key: string): string => {
    assertValidObjectKey(key);

    const target = path.resolve(/* turbopackIgnore: true */ root, key);

    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error('Object key escapes the storage root');
    }

    return target;
  };

  return {
    put: async (key, bytes) => {
      const target = resolveKey(key);

      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
    get: async (key) => {
      try {
        return await readFile(resolveKey(key));
      } catch (error: unknown) {
        if (isMissingFileError(error)) {
          return null;
        }

        throw error;
      }
    },
    delete: async (key) => {
      await rm(resolveKey(key), { force: true });
    },
    exists: async (key) => {
      try {
        return (await stat(resolveKey(key))).isFile();
      } catch (error: unknown) {
        if (isMissingFileError(error)) {
          return false;
        }

        throw error;
      }
    },
  };
};

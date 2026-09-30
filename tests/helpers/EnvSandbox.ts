import { resetAppConfigForTesting } from '@/server/config/AppConfig';

export type EnvSandbox = {
  /** Applies overrides (undefined deletes) and re-reads the config. */
  set: (overrides: Record<string, string | undefined>) => void;
  /** Restores every key touched by `set` to its original value and re-reads the config. */
  restore: () => void;
};

export const createEnvSandbox = (): EnvSandbox => {
  const originals = new Map<string, string | undefined>();

  const assign = (key: string, value: string | undefined): void => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  return {
    set: (overrides) => {
      for (const [key, value] of Object.entries(overrides)) {
        if (!originals.has(key)) {
          originals.set(key, process.env[key]);
        }

        assign(key, value);
      }

      resetAppConfigForTesting();
    },
    restore: () => {
      for (const [key, value] of originals) {
        assign(key, value);
      }

      originals.clear();
      resetAppConfigForTesting();
    },
  };
};

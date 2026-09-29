'use client';

import { createContext, type ReactNode, useContext } from 'react';

import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';

const ConfigContext = createContext<PublicConfigResponse | null>(null);

type ConfigProviderProps = {
  config: PublicConfigResponse;
  children: ReactNode;
};

/** Public (non-secret) settings, resolved on the server once per request — same shape as GET /api/config/public. */
const ConfigProvider = ({ config, children }: ConfigProviderProps) => (
  <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
);

export const usePublicConfig = (): PublicConfigResponse => {
  const config = useContext(ConfigContext);

  if (!config) {
    throw new Error('ConfigProvider is missing');
  }

  return config;
};

export default ConfigProvider;

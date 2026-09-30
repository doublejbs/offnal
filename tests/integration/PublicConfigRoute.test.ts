import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GET as publicConfigRoute } from '@/app/api/config/public/route';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { SUPABASE_KAKAO_ENV } from '../helpers/FakeSupabase';
import { devLogin } from '../helpers/OffnalFlows';

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

const envSandbox = createEnvSandbox();

afterEach(() => {
  envSandbox.restore();
});

afterAll(async () => {
  await env.close();
});

describe('public config', () => {
  it('exposes only non-secret settings', async () => {
    const client = createApiTestClient();
    const response = await client.send(publicConfigRoute, '/api/config/public');
    const body = await readJson<PublicConfigResponse>(response);

    expect(body).toMatchObject({
      appMode: AppMode.DEMO,
      priceKrw: 1900,
      freeMonthLimit: 2,
      authProviders: [AuthProviderType.DEV],
      isMockVision: true,
      isMockPayment: true,
      sourceTtlHours: 24,
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('exposes the source photo retention hours from SOURCE_TTL_HOURS', async () => {
    envSandbox.set({ SOURCE_TTL_HOURS: '12' });

    const client = createApiTestClient();
    const body = await readJson<PublicConfigResponse>(
      await client.send(publicConfigRoute, '/api/config/public'),
    );

    expect(body.sourceTtlHours).toBe(12);
  });

  it('flags mock providers of a live test deployment and keeps dev login off', async () => {
    envSandbox.set({
      OFFNAL_ENV: 'preview',
      APP_MODE: 'live',
      ...SUPABASE_KAKAO_ENV,
      AUTH_PROVIDERS: 'kakao,dev',
    });

    const client = createApiTestClient();
    const body = await readJson<PublicConfigResponse>(
      await client.send(publicConfigRoute, '/api/config/public'),
    );
    const devLoginResponse = await devLogin(client, '라이브 테스트');

    expect(body).toMatchObject({
      appMode: AppMode.LIVE,
      authProviders: [AuthProviderType.KAKAO],
      isMockVision: true,
      isMockPayment: true,
    });
    expect(JSON.stringify(body)).not.toContain('sb_publishable');
    expect(devLoginResponse.status).toBe(404);
  });
});

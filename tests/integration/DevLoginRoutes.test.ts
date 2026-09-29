import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GET as candidatesRoute } from '@/app/api/recognitions/[id]/candidates/route';
import { POST as logoutRoute } from '@/app/auth/logout/route';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { OPEN_REDIRECT_PROBES, requestCandidates } from '../helpers/AuthFlows';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createLoggedInJob, devLogin } from '../helpers/OffnalFlows';

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

describe('dev login', () => {
  it('is 404 outside demo mode', async () => {
    envSandbox.set({ APP_MODE: 'live' });

    const client = createApiTestClient();
    const response = await devLogin(client, '라이브');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type') ?? '').not.toContain('json');
    expect(client.cookies.has('offnal_session')).toBe(false);
  });

  it('only redirects to relative paths', async () => {
    const client = createApiTestClient();

    for (const returnTo of OPEN_REDIRECT_PROBES) {
      const response = await devLogin(client, '리다이렉트', returnTo);

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/`);
    }
  });

  it('redirects invalid submissions back with login=failed instead of JSON', async () => {
    const client = createApiTestClient();
    const response = await client.send((await import('@/app/auth/dev-login/route')).POST, '/auth/dev-login', {
      json: { displayName: '가'.repeat(201), returnTo: '/recognitions/abc' },
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/recognitions/abc?login=failed`);
    expect(response.headers.get('content-type') ?? '').not.toContain('json');
    expect(client.cookies.has('offnal_session')).toBe(false);
  });

  it('accepts form submissions', async () => {
    const client = createApiTestClient();
    const form = new FormData();
    const { POST } = await import('@/app/auth/dev-login/route');

    form.set('displayName', '폼 사용자');
    form.set('returnTo', '/calendar');

    const response = await client.send(POST, '/auth/dev-login', { method: 'POST', form });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/calendar`);
    expect(client.cookies.has('offnal_session')).toBe(true);
  });

  it('rotates the session on every login', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '회전 사용자');
    const firstToken = client.cookies.get('offnal_session');

    await devLogin(client, '회전 사용자');

    const secondToken = client.cookies.get('offnal_session');

    expect(secondToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondToken).not.toBe(firstToken);

    client.cookies.set('offnal_session', firstToken ?? '');

    const withOldToken = await client.send(candidatesRoute, `/api/recognitions/${jobId}/candidates`, {
      params: { id: jobId },
    });

    expect(withOldToken.status).toBe(401);
  });
});

describe('demo logout', () => {
  it('deletes the demo session', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '로그아웃 사용자');
    const response = await client.send(logoutRoute, '/auth/logout', { method: 'POST' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${TEST_APP_URL}/`);
    expect(client.cookies.has('offnal_session')).toBe(false);
    expect((await requestCandidates(client, jobId)).status).toBe(401);
  });
});

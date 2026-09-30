import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETE as deleteDraftRoute } from '@/app/api/drafts/[id]/route';
import { GET as candidatesRoute } from '@/app/api/recognitions/[id]/candidates/route';
import { POST as extractRoute } from '@/app/api/recognitions/[id]/extract/route';
import { POST as processRoute } from '@/app/api/recognitions/[id]/process/route';
import { GET as sourceRoute } from '@/app/api/recognitions/[id]/source/route';
import { GET as statusRoute } from '@/app/api/recognitions/[id]/status/route';
import { POST as uploadRoute } from '@/app/api/recognitions/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CreateRecognitionResponse } from '@/domain/types/api/CreateRecognitionResponse';
import {
  type ApiTestClient,
  buildUploadForm,
  createApiTestClient,
  createTablePng,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import {
  claimJob,
  createLoggedInJob,
  devLogin,
  extractRow,
  getDraft,
  MOCK_FIRST_ROW_ID,
  patchDraft,
  publishDraft,
  uploadAndProcess,
  uploadImage,
} from '../helpers/OffnalFlows';

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterAll(async () => {
  await env.close();
});

const expectNotFound = async (response: Response): Promise<void> => {
  expect(response.status).toBe(404);
  expect((await readJson<ApiErrorBody>(response)).error.code).toBe(ApiErrorCode.NOT_FOUND);
};

const sendJobRequests = (client: ApiTestClient, id: string): Promise<Response>[] => [
  client.send(statusRoute, `/api/recognitions/${id}/status`, { params: { id } }),
  client.send(processRoute, `/api/recognitions/${id}/process`, { method: 'POST', params: { id } }),
  client.send(candidatesRoute, `/api/recognitions/${id}/candidates`, { params: { id } }),
  client.send(sourceRoute, `/api/recognitions/${id}/source`, { params: { id } }),
  client.send(extractRoute, `/api/recognitions/${id}/extract`, {
    json: { rowId: MOCK_FIRST_ROW_ID, yearMonth: '2026-11' },
    params: { id },
  }),
];

describe('ownership', () => {
  it('hides a job from another anonymous session', async () => {
    const owner = createApiTestClient();
    const stranger = createApiTestClient();
    const jobId = await uploadAndProcess(owner);

    await uploadAndProcess(stranger);

    for (const response of await Promise.all(sendJobRequests(stranger, jobId).slice(0, 2))) {
      await expectNotFound(response);
    }
  });

  it('returns 404 when a different anonymous session tries to claim the job', async () => {
    const owner = createApiTestClient();
    const stranger = createApiTestClient();
    const jobId = await uploadAndProcess(owner);

    await devLogin(stranger, '다른 익명');
    await expectNotFound(await claimJob(stranger, jobId));

    await devLogin(owner, '원래 주인');
    expect((await claimJob(owner, jobId)).status).toBe(200);
  });

  it('hides jobs, drafts and sources from another logged-in user', async () => {
    const owner = createApiTestClient();
    const other = createApiTestClient();
    const jobId = await createLoggedInJob(owner, '주인 사용자');
    const draftId = await extractRow(owner, jobId, '2026-11');

    await createLoggedInJob(other, '다른 사용자');

    for (const response of await Promise.all(sendJobRequests(other, jobId))) {
      await expectNotFound(response);
    }

    await expectNotFound(await claimJob(other, jobId));
    await expectNotFound(await getDraft(other, draftId));
    await expectNotFound(await patchDraft(other, draftId, { revision: 1, displayName: '탈취' }));
    await expectNotFound(await publishDraft(other, draftId, 1));
    await expectNotFound(
      await other.send(deleteDraftRoute, `/api/drafts/${draftId}`, {
        method: 'DELETE',
        params: { id: draftId },
      }),
    );

    expect((await getDraft(owner, draftId)).status).toBe(200);
  });

  it('returns 404 for malformed IDs', async () => {
    const client = createApiTestClient();

    await uploadAndProcess(client);
    await expectNotFound(
      await client.send(statusRoute, '/api/recognitions/not-a-uuid/status', { params: { id: 'not-a-uuid' } }),
    );
  });

  it('keeps the job anonymous-owned after logout (session gone, job bound to the user)', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '로그아웃 사용자');
    const { POST: logoutRoute } = await import('@/app/auth/logout/route');
    const logoutResponse = await client.send(logoutRoute, '/auth/logout', { method: 'POST' });

    expect(logoutResponse.status).toBe(303);
    expect(client.cookies.has('offnal_session')).toBe(false);
    await expectNotFound(
      await client.send(statusRoute, `/api/recognitions/${jobId}/status`, { params: { id: jobId } }),
    );
  });
});

describe('CSRF origin check', () => {
  it('rejects uploads without an Origin header', async () => {
    const client = createApiTestClient();
    const response = await client.send(uploadRoute, '/api/recognitions', {
      method: 'POST',
      form: buildUploadForm(await createTablePng()),
      origin: null,
    });

    expect(response.status).toBe(403);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe(ApiErrorCode.FORBIDDEN_ORIGIN);
  });

  it('rejects mutations from a foreign origin', async () => {
    const client = createApiTestClient();
    const foreignUpload = await client.send(uploadRoute, '/api/recognitions', {
      method: 'POST',
      form: buildUploadForm(await createTablePng()),
      origin: 'https://evil.example',
    });

    expect(foreignUpload.status).toBe(403);

    const jobId = await createLoggedInJob(client, 'CSRF 사용자');
    const draftId = await extractRow(client, jobId, '2026-11');
    const foreignPatch = await client.send(
      (await import('@/app/api/drafts/[id]/route')).PATCH,
      `/api/drafts/${draftId}`,
      {
        method: 'PATCH',
        json: { revision: 1, displayName: 'x' },
        params: { id: draftId },
        origin: 'http://localhost:9999',
      },
    );

    expect(foreignPatch.status).toBe(403);

    const foreignClaim = await client.send(
      (await import('@/app/api/recognitions/[id]/claim/route')).POST,
      `/api/recognitions/${jobId}/claim`,
      { method: 'POST', params: { id: jobId }, origin: null },
    );

    expect(foreignClaim.status).toBe(403);
  });

  it('accepts the same origin', async () => {
    const client = createApiTestClient();
    const response = await uploadImage(client, await createTablePng());

    expect(response.status).toBe(201);
    expect((await readJson<CreateRecognitionResponse>(response)).id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

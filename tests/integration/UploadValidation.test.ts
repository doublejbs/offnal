import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { anonymousSessions } from '@/server/db/Schema';
import {
  createApiTestClient,
  createPngFixture,
  createTablePng,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { uploadImage } from '../helpers/OffnalFlows';

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

const expectError = async (response: Response, status: number, code: ApiErrorCode): Promise<void> => {
  expect(response.status).toBe(status);
  expect((await readJson<ApiErrorBody>(response)).error.code).toBe(code);
};

const buildHeicBytes = (): Buffer => {
  const bytes = Buffer.alloc(64);

  bytes.writeUInt32BE(24, 0);
  bytes.write('ftypheic', 4, 'ascii');

  return bytes;
};

describe('upload validation', () => {
  it('rejects a text file disguised as PNG with 415', async () => {
    const client = createApiTestClient();

    await expectError(
      await uploadImage(client, Buffer.from('this is not an image at all')),
      415,
      ApiErrorCode.UNSUPPORTED_MEDIA_TYPE,
    );
  });

  it('rejects HEIC with 415 HEIC_UNSUPPORTED', async () => {
    const client = createApiTestClient();

    await expectError(await uploadImage(client, buildHeicBytes()), 415, ApiErrorCode.HEIC_UNSUPPORTED);
  });

  it('rejects files over UPLOAD_MAX_BYTES with 413', async () => {
    envSandbox.set({ UPLOAD_MAX_BYTES: '1000' });

    const client = createApiTestClient();
    const bytes = await createTablePng();

    expect(bytes.length).toBeGreaterThan(1000);
    await expectError(await uploadImage(client, bytes), 413, ApiErrorCode.FILE_TOO_LARGE);
  });

  it('rejects images smaller than 200px on a side', async () => {
    const client = createApiTestClient();

    await expectError(
      await uploadImage(client, await createPngFixture(150, 900)),
      400,
      ApiErrorCode.IMAGE_TOO_SMALL,
    );
  });

  it('rejects a missing file field with 400', async () => {
    const client = createApiTestClient();
    const { POST } = await import('@/app/api/recognitions/route');

    await expectError(
      await client.send(POST, '/api/recognitions', { method: 'POST', form: new FormData() }),
      400,
      ApiErrorCode.VALIDATION_ERROR,
    );
  });

  it('limits uploads per anonymous session with 429', async () => {
    envSandbox.set({ RATE_LIMIT_ANON_DAILY: '2' });

    const client = createApiTestClient();
    const bytes = await createTablePng();

    expect((await uploadImage(client, bytes)).status).toBe(201);
    expect((await uploadImage(client, bytes)).status).toBe(201);
    await expectError(await uploadImage(client, bytes), 429, ApiErrorCode.RATE_LIMITED);
  });

  it('limits uploads per IP across anonymous sessions', async () => {
    envSandbox.set({ RATE_LIMIT_IP_DAILY: '1' });

    const client = createApiTestClient();
    const bytes = await createTablePng();

    expect((await uploadImage(client, bytes)).status).toBe(201);
    client.cookies.clear();
    await expectError(await uploadImage(client, bytes), 429, ApiErrorCode.RATE_LIMITED);
  });

  it('counts uploads that fail validation toward the limit', async () => {
    envSandbox.set({ RATE_LIMIT_IP_DAILY: '2' });

    const client = createApiTestClient();

    expect((await uploadImage(client, Buffer.from('not an image'))).status).toBe(415);
    expect((await uploadImage(client, buildHeicBytes())).status).toBe(415);
    await expectError(await uploadImage(client, await createTablePng()), 429, ApiErrorCode.RATE_LIMITED);
  });

  it('does not create an anonymous session when the upload is rate limited', async () => {
    envSandbox.set({ RATE_LIMIT_IP_DAILY: '1' });

    const client = createApiTestClient();
    const bytes = await createTablePng();

    expect((await uploadImage(client, bytes)).status).toBe(201);

    const sessionsBefore = (await env.db.select().from(anonymousSessions)).length;

    client.cookies.clear();
    await expectError(await uploadImage(client, bytes), 429, ApiErrorCode.RATE_LIMITED);
    expect(client.cookies.has('offnal_anon')).toBe(false);
    expect((await env.db.select().from(anonymousSessions)).length).toBe(sessionsBefore);
  });
});

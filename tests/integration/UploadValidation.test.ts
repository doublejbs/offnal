import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { resetAppConfigForTesting } from '@/server/config/AppConfig';
import {
  createApiTestClient,
  createPngFixture,
  createTablePng,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { uploadImage } from '../helpers/OffnalFlows';

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  delete process.env.UPLOAD_MAX_BYTES;
  delete process.env.RATE_LIMIT_ANON_DAILY;
  delete process.env.RATE_LIMIT_IP_DAILY;
  resetAppConfigForTesting();
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
    process.env.UPLOAD_MAX_BYTES = '1000';
    resetAppConfigForTesting();

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
    process.env.RATE_LIMIT_ANON_DAILY = '2';
    resetAppConfigForTesting();

    const client = createApiTestClient();
    const bytes = await createTablePng();

    expect((await uploadImage(client, bytes)).status).toBe(201);
    expect((await uploadImage(client, bytes)).status).toBe(201);
    await expectError(await uploadImage(client, bytes), 429, ApiErrorCode.RATE_LIMITED);
  });

  it('limits uploads per IP across anonymous sessions', async () => {
    process.env.RATE_LIMIT_IP_DAILY = '1';
    resetAppConfigForTesting();

    const client = createApiTestClient();
    const bytes = await createTablePng();

    expect((await uploadImage(client, bytes)).status).toBe(201);
    client.cookies.clear();
    await expectError(await uploadImage(client, bytes), 429, ApiErrorCode.RATE_LIMITED);
  });
});

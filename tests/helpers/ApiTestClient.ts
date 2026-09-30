import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import sharp from 'sharp';

import { resetAppConfigForTesting } from '@/server/config/AppConfig';
import { createTestDb, type Db, setDbForTesting } from '@/server/db/Database';
import { createLocalObjectStorage } from '@/server/storage/LocalObjectStorage';
import { type ObjectStorage } from '@/server/storage/ObjectStorage';
import { setObjectStorageForTesting } from '@/server/storage/StorageFactory';
import { setVisionProviderForTesting } from '@/server/vision/VisionFactory';

export const TEST_APP_URL = 'http://localhost:3100';

type RouteContext<TParams> = { params: Promise<TParams> };

export type TestRouteHandler<TParams> = (
  request: NextRequest,
  context: RouteContext<TParams>,
) => Promise<Response>;

export type TestRequestOptions<TParams> = {
  method?: string;
  json?: unknown;
  form?: FormData;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Origin header; defaults to APP_URL. Pass null to omit it. */
  origin?: string | null;
  params?: TParams;
};

export type ApiTestClient = {
  cookies: Map<string, string>;
  ip: string;
  buildRequest: <TParams>(requestPath: string, options?: TestRequestOptions<TParams>) => NextRequest;
  send: <TParams>(
    handler: TestRouteHandler<TParams>,
    requestPath: string,
    options?: TestRequestOptions<TParams>,
  ) => Promise<Response>;
};

let ipCounter = 0;

const isExpiredCookie = (attributes: string[]): boolean =>
  attributes.some((attribute) => {
    const [rawName, rawValue = ''] = attribute.split('=');
    const name = rawName?.trim().toLowerCase();

    if (name === 'max-age') {
      return Number(rawValue.trim()) <= 0;
    }

    if (name === 'expires') {
      return new Date(rawValue.trim()).getTime() <= Date.now();
    }

    return false;
  });

const absorbSetCookies = (cookies: Map<string, string>, response: Response): void => {
  for (const header of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = header.split(';');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    if (value === '' || isExpiredCookie(attributes)) {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
};

const buildCookieHeader = (cookies: Map<string, string>): string =>
  [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

/** Simulates one browser: keeps its own cookie jar and client IP. */
export const createApiTestClient = (): ApiTestClient => {
  ipCounter += 1;

  const cookies = new Map<string, string>();
  const ip = `203.0.113.${ipCounter}`;

  const buildRequest = <TParams>(
    requestPath: string,
    options: TestRequestOptions<TParams> = {},
  ): NextRequest => {
    const method = options.method ?? (options.json !== undefined || options.form ? 'POST' : 'GET');
    const headers = new Headers(options.headers);

    headers.set('x-forwarded-for', ip);

    if (options.origin !== null) {
      headers.set('origin', options.origin ?? TEST_APP_URL);
    }

    if (cookies.size > 0) {
      headers.set('cookie', buildCookieHeader(cookies));
    }

    let body: BodyInit | undefined = options.body;

    if (options.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.json);
    }

    if (options.form) {
      body = options.form;
    }

    return new NextRequest(new URL(requestPath, TEST_APP_URL), { method, headers, body });
  };

  const send = async <TParams>(
    handler: TestRouteHandler<TParams>,
    requestPath: string,
    options: TestRequestOptions<TParams> = {},
  ): Promise<Response> => {
    const request = buildRequest(requestPath, options);
    const response = await handler(request, { params: Promise.resolve(options.params ?? ({} as TParams)) });

    absorbSetCookies(cookies, response);

    return response;
  };

  return { cookies, ip, buildRequest, send };
};

export const createPngFixture = async (width: number, height: number): Promise<Buffer> => {
  const lines = Array.from(
    { length: 10 },
    (_, index) => `<rect x="0" y="${index * (height / 10)}" width="${width}" height="2" fill="#333"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${lines}</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
};

/** 1200x900 table-like image: mock recognition succeeds. */
export const createTablePng = (): Promise<Buffer> => createPngFixture(1200, 900);

/** 250x900 image: passes upload validation, but mock recognition fails with NO_TABLE. */
export const createNarrowPng = (): Promise<Buffer> => createPngFixture(250, 900);

export const buildUploadForm = (bytes: Buffer, fileName = 'schedule.png', type = 'image/png'): FormData => {
  const form = new FormData();

  form.set('file', new File([new Uint8Array(bytes)], fileName, { type }));

  return form;
};

export type IntegrationEnvironment = {
  db: Db;
  storage: ObjectStorage;
  storageDir: string;
  close: () => Promise<void>;
};

/** Fresh in-memory DB, temp-dir local storage and default (mock) vision provider for one test file. */
export const setupIntegrationEnvironment = async (): Promise<IntegrationEnvironment> => {
  resetAppConfigForTesting();

  const testDb = await createTestDb();
  const storageDir = await mkdtemp(path.join(tmpdir(), 'offnal-storage-'));
  const storage = createLocalObjectStorage(storageDir);

  setDbForTesting(testDb.db);
  setObjectStorageForTesting(storage);
  setVisionProviderForTesting(null);

  return {
    db: testDb.db,
    storage,
    storageDir,
    close: async () => {
      setDbForTesting(null);
      setObjectStorageForTesting(null);
      setVisionProviderForTesting(null);
      await testDb.close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
};

export const readJson = async <T>(response: Response): Promise<T> => (await response.json()) as T;

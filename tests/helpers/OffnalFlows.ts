import { expect } from 'vitest';

import { POST as publishDraftRoute } from '@/app/api/drafts/[id]/publish/route';
import { GET as getDraftRoute, PATCH as patchDraftRoute } from '@/app/api/drafts/[id]/route';
import { POST as claimRoute } from '@/app/api/recognitions/[id]/claim/route';
import { POST as extractRoute } from '@/app/api/recognitions/[id]/extract/route';
import { POST as processRoute } from '@/app/api/recognitions/[id]/process/route';
import { POST as uploadRoute } from '@/app/api/recognitions/route';
import { POST as devLoginRoute } from '@/app/auth/dev-login/route';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { type CreateRecognitionResponse } from '@/domain/types/api/CreateRecognitionResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type ExtractRecognitionResponse } from '@/domain/types/api/ExtractRecognitionResponse';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type ApiTestClient, buildUploadForm, createTablePng, readJson } from './ApiTestClient';

export const MOCK_FIRST_ROW_ID = 'r1';

export const uploadImage = async (client: ApiTestClient, bytes: Buffer): Promise<Response> =>
  client.send(uploadRoute, '/api/recognitions', { method: 'POST', form: buildUploadForm(bytes) });

export const uploadAndProcess = async (client: ApiTestClient, bytes?: Buffer): Promise<string> => {
  const uploadResponse = await uploadImage(client, bytes ?? (await createTablePng()));

  expect(uploadResponse.status).toBe(201);

  const { id } = await readJson<CreateRecognitionResponse>(uploadResponse);
  const processResponse = await client.send(processRoute, `/api/recognitions/${id}/process`, {
    method: 'POST',
    params: { id },
  });
  const status = await readJson<RecognitionStatusResponse>(processResponse);

  expect(processResponse.status).toBe(200);
  expect(status.status).toBe(RecognitionStatus.RECOGNIZED);

  return id;
};

export const devLogin = async (
  client: ApiTestClient,
  displayName: string,
  returnTo = '/',
): Promise<Response> => client.send(devLoginRoute, '/auth/dev-login', { json: { displayName, returnTo } });

export const claimJob = async (client: ApiTestClient, jobId: string): Promise<Response> =>
  client.send(claimRoute, `/api/recognitions/${jobId}/claim`, { method: 'POST', params: { id: jobId } });

export const extractRow = async (
  client: ApiTestClient,
  jobId: string,
  yearMonth: string,
  rowId = MOCK_FIRST_ROW_ID,
): Promise<string> => {
  const response = await client.send(extractRoute, `/api/recognitions/${jobId}/extract`, {
    json: { rowId, yearMonth },
    params: { id: jobId },
  });

  expect(response.status).toBe(200);

  return (await readJson<ExtractRecognitionResponse>(response)).draftId;
};

export const getDraft = async (client: ApiTestClient, draftId: string): Promise<Response> =>
  client.send(getDraftRoute, `/api/drafts/${draftId}`, { params: { id: draftId } });

export const readDraft = async (client: ApiTestClient, draftId: string): Promise<DraftResponse> => {
  const response = await getDraft(client, draftId);

  expect(response.status).toBe(200);

  return readJson<DraftResponse>(response);
};

export const patchDraft = async (client: ApiTestClient, draftId: string, body: unknown): Promise<Response> =>
  client.send(patchDraftRoute, `/api/drafts/${draftId}`, {
    method: 'PATCH',
    json: body,
    params: { id: draftId },
  });

export const publishDraft = async (
  client: ApiTestClient,
  draftId: string,
  revision: number,
): Promise<Response> =>
  client.send(publishDraftRoute, `/api/drafts/${draftId}/publish`, {
    json: { revision },
    params: { id: draftId },
  });

/** Confirms every entry; unreadable/missing dates become `fillCode`. */
export const resolveEntries = (entries: ShiftEntry[], fillCode = 'OFF'): ShiftEntry[] =>
  entries.map((entry) => ({
    ...entry,
    code: entry.code ?? fillCode,
    reviewReasons: [],
    confirmed: true,
  }));

/** Extracts the first mock row for `yearMonth` and resolves all review items. Returns the ready draft. */
export const createReadyDraft = async (
  client: ApiTestClient,
  jobId: string,
  yearMonth: string,
): Promise<DraftResponse> => {
  const draftId = await extractRow(client, jobId, yearMonth);
  const current = await readDraft(client, draftId);
  const response = await patchDraft(client, draftId, {
    revision: current.draft.revision,
    entries: resolveEntries(current.draft.entries),
  });

  expect(response.status).toBe(200);

  return readJson<DraftResponse>(response);
};

/** Upload → process → dev login (claims the job). Returns the job ID. */
export const createLoggedInJob = async (client: ApiTestClient, displayName: string): Promise<string> => {
  const jobId = await uploadAndProcess(client);
  const loginResponse = await devLogin(client, displayName, `/recognitions/${jobId}`);

  expect(loginResponse.status).toBe(303);

  return jobId;
};

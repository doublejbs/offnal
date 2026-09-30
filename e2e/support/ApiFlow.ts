import { randomBytes } from 'node:crypto';

import { type APIRequestContext, expect } from '@playwright/test';

import {
  MOCK_LEAVE_CODE,
  MOCK_UNDEFINED_CODE_DAYS,
  MOCK_WORK_CODE_OUTSIDE_LEGEND,
} from '@/domain/MockFixtureDays';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import {
  currentYearMonthInSeoul,
  dayOfDate,
  daysInMonth,
  nextYearMonth,
  toDateString,
} from '@/domain/YearMonth';
import { createPngBuffer, TABLE_IMAGE_SIZE } from './FixtureImages';

/** Must equal the webServer APP_URL: every mutating route checks the Origin header. */
export const APP_ORIGIN = 'http://localhost:3100';

/** Virtual names from the mock provider (never real people). Row IDs are r1…r4 in this order. */
export const MOCK_NAMES = ['김하루', '이여름', '박지우', '남궁하늘빛나래'];

/** Mock provider fixture: day 14 is ambiguous ("E?"), day 20 unreadable (null). */
export const AMBIGUOUS_DAY = 14;
export const UNREADABLE_DAY = 20;

/** How the tests define the fixture's codes outside the legend (MockFixtureDays): 연차 off, W timed. */
export const W_START_TIME = '09:00';
export const W_END_TIME = '18:00';

const SHIFT_PATTERN = ['D', 'D', 'E', 'E', 'N', 'N', 'OFF', 'OFF', 'S', 'OFF'];
const OFF_CODE = 'OFF';

const mutatingHeaders = { Origin: APP_ORIGIN };

/** Month the mock provider reports (next month in Seoul). */
export const getMockYearMonth = (): string => nextYearMonth(currentYearMonthInSeoul(new Date()));

export const addMonths = (yearMonth: string, count: number): string => {
  let result = yearMonth;

  for (let index = 0; index < count; index += 1) {
    result = nextYearMonth(result);
  }

  return result;
};

export const uniqueName = (prefix: string): string => `${prefix}-${randomBytes(4).toString('hex')}`;

/**
 * Codes of the mock row after the user fixes the two review days. `overrides` wins over the pattern.
 * Mirrors MockVisionProvider's deterministic pattern.
 */
export const buildExpectedCodes = (
  yearMonth: string,
  rowIndex: number,
  overrides: Record<number, string>,
): string[] =>
  Array.from({ length: daysInMonth(yearMonth) }, (_, index) => {
    const day = index + 1;

    return (
      overrides[day] ??
      MOCK_UNDEFINED_CODE_DAYS[day] ??
      SHIFT_PATTERN[(day - 1 + rowIndex * 3) % SHIFT_PATTERN.length] ??
      OFF_CODE
    );
  });

export const countWorkAndOff = (codes: string[], offCodes: string[] = [OFF_CODE, MOCK_LEAVE_CODE]) => {
  const offCount = codes.filter((code) => offCodes.includes(code)).length;

  return { workCount: codes.length - offCount, offCount };
};

export const uploadViaApi = async (request: APIRequestContext, png?: Buffer): Promise<string> => {
  const buffer = png ?? (await createPngBuffer(TABLE_IMAGE_SIZE.width, TABLE_IMAGE_SIZE.height));
  const response = await request.post('/api/recognitions', {
    headers: mutatingHeaders,
    multipart: { file: { name: 'schedule.png', mimeType: 'image/png', buffer } },
  });

  expect(response.status(), await response.text()).toBe(201);

  return ((await response.json()) as { id: string }).id;
};

export const processViaApi = async (request: APIRequestContext, id: string): Promise<void> => {
  const response = await request.post(`/api/recognitions/${id}/process`, { headers: mutatingHeaders });

  expect(response.ok(), await response.text()).toBe(true);
};

/** Demo login through the same route as the form; the session cookie lands in the browser context. */
export const devLoginViaApi = async (request: APIRequestContext, displayName: string): Promise<void> => {
  const response = await request.post('/auth/dev-login', {
    headers: mutatingHeaders,
    data: { displayName, returnTo: '/' },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(303);
  expect(response.headers().location ?? '').not.toContain('login=failed');
};

export const claimViaApi = async (request: APIRequestContext, id: string): Promise<void> => {
  const response = await request.post(`/api/recognitions/${id}/claim`, { headers: mutatingHeaders });

  expect(response.ok(), await response.text()).toBe(true);
};

export const extractViaApi = async (
  request: APIRequestContext,
  id: string,
  body: { rowId: string; yearMonth: string },
): Promise<string> => {
  const response = await request.post(`/api/recognitions/${id}/extract`, {
    headers: mutatingHeaders,
    data: body,
  });

  expect(response.ok(), await response.text()).toBe(true);

  return ((await response.json()) as { draftId: string }).draftId;
};

export const getDraftViaApi = async (request: APIRequestContext, draftId: string): Promise<DraftResponse> => {
  const response = await request.get(`/api/drafts/${draftId}`);

  expect(response.ok(), await response.text()).toBe(true);

  return (await response.json()) as DraftResponse;
};

/** Defines the fixture's codes outside the legend the way a user would (연차 off, W timed). */
export const defineUndefinedCodes = (definitions: ShiftDefinition[]): ShiftDefinition[] =>
  definitions.map((definition) => {
    if (definition.code === MOCK_LEAVE_CODE) {
      return { ...definition, isOff: true };
    }

    if (definition.code === MOCK_WORK_CODE_OUTSIDE_LEGEND) {
      return { ...definition, startTime: W_START_TIME, endTime: W_END_TIME, endsNextDay: false };
    }

    return definition;
  });

type ConfirmOptions = {
  /** Code per day of month for days to change (defaults fix the two review days). */
  codeByDay?: Record<number, string>;
  extraDefinitions?: ShiftDefinition[];
  displayName?: string;
};

export const DEFAULT_FIXES: Record<number, string> = { [AMBIGUOUS_DAY]: 'E', [UNREADABLE_DAY]: 'D' };

/** Confirms every day (fixing the review days, defining 연차/W) the way the editor would. Returns the new revision. */
export const confirmDraftViaApi = async (
  request: APIRequestContext,
  draftId: string,
  options: ConfirmOptions = {},
): Promise<number> => {
  const { draft } = await getDraftViaApi(request, draftId);
  const codeByDay = options.codeByDay ?? DEFAULT_FIXES;
  const entries: ShiftEntry[] = draft.entries.map((entry) => ({
    ...entry,
    code: codeByDay[dayOfDate(entry.date)] ?? entry.code,
    confirmed: true,
  }));
  const response = await request.patch(`/api/drafts/${draftId}`, {
    headers: mutatingHeaders,
    data: {
      revision: draft.revision,
      entries,
      definitions: [...defineUndefinedCodes(draft.definitions), ...(options.extraDefinitions ?? [])],
      ...(options.displayName ? { displayName: options.displayName } : {}),
    },
  });

  expect(response.ok(), await response.text()).toBe(true);

  return ((await response.json()) as DraftResponse).draft.revision;
};

export const publishViaApi = async (
  request: APIRequestContext,
  draftId: string,
  revision: number,
): Promise<PublishDraftResponse> => {
  const response = await request.post(`/api/drafts/${draftId}/publish`, {
    headers: mutatingHeaders,
    data: { revision },
  });

  expect(response.ok(), await response.text()).toBe(true);

  return (await response.json()) as PublishDraftResponse;
};

type DraftSetup = {
  yearMonth: string;
  rowId?: string;
};

/** Logged-in user: upload → process → claim → extract. Returns the recognition and draft IDs. */
export const createDraftViaApi = async (request: APIRequestContext, setup: DraftSetup) => {
  const recognitionId = await uploadViaApi(request);

  await processViaApi(request, recognitionId);
  await claimViaApi(request, recognitionId);

  const draftId = await extractViaApi(request, recognitionId, {
    rowId: setup.rowId ?? 'r1',
    yearMonth: setup.yearMonth,
  });

  return { recognitionId, draftId };
};

/** Logged-in user: a whole published month (fixed review days) without going through the UI. */
export const publishMonthViaApi = async (
  request: APIRequestContext,
  setup: DraftSetup & ConfirmOptions,
): Promise<PublishDraftResponse> => {
  const { draftId } = await createDraftViaApi(request, setup);
  const revision = await confirmDraftViaApi(request, draftId, setup);

  return publishViaApi(request, draftId, revision);
};

export const enableShareViaApi = async (
  request: APIRequestContext,
  body: { displayName: string; visibleMonths: string[] },
): Promise<string> => {
  const response = await request.post('/api/calendar/share', { headers: mutatingHeaders, data: body });

  expect(response.ok(), await response.text()).toBe(true);

  const { url } = (await response.json()) as { url: string | null };

  expect(url).not.toBeNull();

  return url ?? '';
};

export const dateOfMonth = (yearMonth: string, day: number): string => {
  const [year, month] = yearMonth.split('-').map(Number);

  return toDateString(year ?? 0, month ?? 0, day);
};

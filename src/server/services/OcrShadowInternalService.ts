import 'server-only';

import { eq } from 'drizzle-orm';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { getAppConfig } from '@/server/config/AppConfig';
import { isEqualConstantTime } from '@/server/crypto/TokenCrypto';
import { type DbExecutor, getDb } from '@/server/db/Database';
import { drafts } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { describeError } from '@/server/errors/ErrorName';
import { jsonResponse, NO_STORE, withRoute } from '@/server/http/RouteHelpers';
import { executeOcrShadow, probeOcrShadow } from '@/server/services/OcrShadowExecutor';
import {
  OCR_SHADOW_DRAFT_PARAM,
  OCR_SHADOW_JOB_PARAM,
  OCR_SHADOW_PROBE_PARAM,
} from '@/server/services/OcrShadowRouteLimits';
import { type OcrShadowInput } from '@/server/services/OcrShadowRunner';

const BEARER_PREFIX = 'Bearer ';
const PROBE_FLAG_VALUES = new Set(['1', 'true']);

const idSchema = z.uuid();

const ACCEPTED_STATUS = 202;

/** Response of an accepted shadow run (the outcome is only recorded as a row). */
export type OcrShadowAcceptedResponse = { accepted: true };

type ScheduleTask = (task: () => Promise<void>) => void;

type InternalGlobal = typeof globalThis & { __offnalOcrShadowRouteSchedule?: ScheduleTask };

const internalGlobal = globalThis as InternalGlobal;

/** Replaces `after()` for the run started by this route (null restores it). Tests only. */
export const setOcrShadowRouteScheduleForTesting = (schedule: ScheduleTask | null): void => {
  internalGlobal.__offnalOcrShadowRouteSchedule = schedule ?? undefined;
};

const resolveSchedule = (): ScheduleTask => internalGlobal.__offnalOcrShadowRouteSchedule ?? after;

/**
 * Bearer check of the internal route (Spec §22-11), constant time. False when no secret is configured
 * (the route is then disabled).
 */
export const isOcrInternalAuthorized = (authorization: string | null, secret: string | null): boolean => {
  if (!secret) {
    return false;
  }

  const header = authorization ?? '';
  const provided = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';

  return isEqualConstantTime(provided, secret);
};

/** Indistinguishable from a route that does not exist: no body, no hint. */
export const notFoundResponse = (): NextResponse =>
  new NextResponse(null, { status: 404, headers: { 'Cache-Control': NO_STORE } });

/** Photo bytes from the body, at most the upload limit (the extract forwards an accepted upload). */
const readImageBody = async (request: NextRequest): Promise<Buffer> => {
  const maxBytes = getAppConfig().uploadMaxBytes;
  const declared = Number(request.headers.get('content-length') ?? '0');

  if (declared > maxBytes) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  const bytes = Buffer.from(await request.arrayBuffer());

  if (bytes.length > maxBytes) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  if (bytes.length === 0) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR);
  }

  return bytes;
};

const readIdParam = (request: NextRequest, name: string): string => {
  const parsed = idSchema.safeParse(request.nextUrl.searchParams.get(name));

  if (!parsed.success) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { details: { fields: [name] } });
  }

  return parsed.data;
};

/**
 * Comparison input from the draft the extract just created: the chosen name, the confirmed month and the
 * AI entries as first stored (`initial_entries`, Spec §23.7 — later edits overwrite `entries`). Null when
 * the draft is gone, belongs to another job or is not a row extract.
 */
const loadShadowInput = async (
  db: DbExecutor,
  draftId: string,
  jobId: string,
  sourceBytes: Buffer,
): Promise<OcrShadowInput | null> => {
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);

  if (!draft || draft.recognitionJobId !== jobId || draft.personRowId === null || !draft.initialEntries) {
    return null;
  }

  return {
    jobId,
    sourceBytes,
    name: draft.displayName,
    yearMonth: draft.yearMonth,
    aiSchedule: { entries: draft.initialEntries, definitions: draft.definitions, sourceCells: [] },
  };
};

const handleAuthorized = async (request: NextRequest, routeStartedAt: number): Promise<Response> => {
  const probe = PROBE_FLAG_VALUES.has(request.nextUrl.searchParams.get(OCR_SHADOW_PROBE_PARAM) ?? '');

  if (probe) {
    return jsonResponse(await probeOcrShadow(await readImageBody(request), routeStartedAt));
  }

  const draftId = readIdParam(request, OCR_SHADOW_DRAFT_PARAM);
  const jobId = readIdParam(request, OCR_SHADOW_JOB_PARAM);
  const sourceBytes = await readImageBody(request);
  const db = await getDb();
  const input = await loadShadowInput(db, draftId, jobId, sourceBytes);

  if (!input) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  // Acknowledged right away: the run continues in this invocation after the response (same maxDuration,
  // measured from the route's start), so the extract only waits for the 202.
  resolveSchedule()(async () => {
    try {
      await executeOcrShadow(db, input, routeStartedAt);
    } catch (error: unknown) {
      console.warn('[ocr-shadow] run failed', { name: describeError(error) });
    }
  });

  const body: OcrShadowAcceptedResponse = { accepted: true };

  return jsonResponse(body, ACCEPTED_STATUS);
};

/** The configured secret, or null when the configuration itself is invalid (the route then stays hidden). */
const readSecret = (): string | null => {
  try {
    return getAppConfig().ocrInternalSecret;
  } catch (error: unknown) {
    console.warn('[ocr-shadow] invalid configuration', { name: describeError(error) });

    return null;
  }
};

/**
 * `POST /api/internal/ocr-shadow` (Spec §22-11): a server-to-server call from the extract (no CSRF or
 * Origin check). Any authentication failure, and an invalid configuration, is a bare 404. A run answers
 * 202 once its input is validated and runs after the response; a probe answers with its numbers.
 * `routeStartedAt` (epoch ms) is the start of this invocation, for the maxDuration budget.
 */
export const handleOcrShadowRequest = async (
  request: NextRequest,
  routeStartedAt: number,
): Promise<Response> => {
  if (!isOcrInternalAuthorized(request.headers.get('authorization'), readSecret())) {
    return notFoundResponse();
  }

  return withRoute((authorized: NextRequest) => handleAuthorized(authorized, routeStartedAt))(request);
};

import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';
import { type TeamRosterListResponse } from '@/domain/types/api/TeamRosterListResponse';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { teamRosterRows, teamRosters } from '@/server/db/Schema';
import { createMockVisionProvider, MOCK_TEAM_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';
import { setVisionProviderForTesting } from '@/server/vision/VisionFactory';
import { type VisionProvider, VisionProviderError } from '@/server/vision/VisionProvider';
import {
  type ApiTestClient,
  createNarrowPng,
  createPngFixture,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { requestCandidates } from '../helpers/AuthFlows';
import {
  createRoster,
  createTeam,
  extractAll,
  extractNext,
  listRosters,
  loggedInClient,
  patchRoster,
  readRoster,
  TEAM_MONTH,
  uploadRoster,
} from '../helpers/TeamFlows';

let env: IntegrationEnvironment;
let admin: ApiTestClient;
let teamId: string;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
  admin = await loggedInClient('추출 관리자');
  teamId = (await createTeam(admin, '추출 병동')).team.id;
});

afterEach(() => {
  setVisionProviderForTesting(null);
});

afterAll(async () => {
  await env.close();
});

type CountingProvider = {
  provider: VisionProvider;
  callsByName: Map<string, number>;
};

/** Mock provider counting second-pass calls per row name; `failNames` always fail with a provider error. */
const createCountingProvider = (failNames: string[] = [], delayMs = 0): CountingProvider => {
  const base = createMockVisionProvider({ delayMs });
  const callsByName = new Map<string, number>();
  const provider: VisionProvider = {
    ...base,
    extractPerson: async (image, input, signal) => {
      const key = `${input.rowId}:${input.name}`;

      callsByName.set(key, (callsByName.get(key) ?? 0) + 1);

      if (failNames.includes(input.name)) {
        throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
      }

      return base.extractPerson(image, input, signal);
    },
  };

  return { provider, callsByName };
};

const readExtract = async (response: Response): Promise<ExtractNextResponse> => {
  expect(response.status).toBe(200);

  return readJson<ExtractNextResponse>(response);
};

describe('roster upload', () => {
  it('requires the authority confirmation and a valid image', async () => {
    const missing = await uploadRoster(admin, teamId, { authorityConfirmed: false });
    const body = await readJson<ApiErrorBody>(missing);

    expect(missing.status).toBe(400);
    expect(body.error.message).toContain('권한');
    expect(
      (await uploadRoster(admin, teamId, { bytes: Buffer.from('not an image at all, just some text bytes') }))
        .status,
    ).toBe(415);
    expect((await uploadRoster(admin, teamId, { yearMonth: '2026-13' })).status).toBe(400);
  });

  it('creates a DRAFT roster with the consent time and an admin-owned recognition job', async () => {
    const rosterId = await createRoster(admin, teamId);
    const roster = await readRoster(admin, teamId, rosterId);

    expect(roster.roster).toMatchObject({
      status: TeamRosterStatus.DRAFT,
      revision: null,
      yearMonth: TEAM_MONTH,
      sourceAvailable: true,
    });
    expect(roster.roster.authorityConfirmedAt).not.toBeNull();
    expect(roster.progress.phase).toBe(TeamRosterPhase.RECOGNIZING);
    expect(roster.rows).toEqual([]);

    const list = await readJson<TeamRosterListResponse>(await listRosters(admin, teamId));

    expect(list.rosters.map((item) => item.id)).toContain(rosterId);
  });
});

describe('extract-next', () => {
  it('runs the first pass, then reads at most 4 rows per call until every row is done', async () => {
    const rosterId = await createRoster(admin, teamId);
    const first = await readExtract(await extractNext(admin, teamId, rosterId));

    expect(first.progress).toMatchObject({
      phase: TeamRosterPhase.EXTRACTING,
      total: 10,
      done: 4,
      pending: 6,
    });
    expect(first.processedRowIds).toHaveLength(4);

    const second = await readExtract(await extractNext(admin, teamId, rosterId));

    expect(second.progress).toMatchObject({ done: 8, pending: 2 });

    const third = await readExtract(await extractNext(admin, teamId, rosterId));

    expect(third.progress).toMatchObject({ phase: TeamRosterPhase.READY, done: 10, pending: 0, failed: 0 });
    expect(third.processedRowIds).toHaveLength(2);

    // Nothing left: further calls are harmless.
    expect((await readExtract(await extractNext(admin, teamId, rosterId))).processedRowIds).toEqual([]);

    const roster = await readRoster(admin, teamId, rosterId);

    expect(roster.rows.map((row) => row.displayName)).toEqual(MOCK_TEAM_CANDIDATE_NAMES);
    expect(
      roster.rows
        .filter((row) => row.displayName === '김하루')
        .map((row) => [row.rowKey, row.sameNameOrdinal]),
    ).toEqual([
      ['김하루#1', 1],
      ['김하루#2', 2],
    ]);
    expect(roster.rows.every((row) => row.extractStatus === RosterRowExtractStatus.DONE)).toBe(true);
    // Admin view keeps review data: ambiguous day 14, unreadable day 20, codes outside the legend.
    expect(roster.rows[0]?.reviewCount).toBeGreaterThan(0);
    expect(roster.rows[0]?.sourceCells.length).toBe(30);
    expect(roster.definitions.map((definition) => definition.code)).toEqual(
      expect.arrayContaining(['D', 'E', 'N', 'OFF', '연차', 'W']),
    );
    expect(roster.publishable).toBe(false);
    expect(roster.blockers).toHaveLength(10);
  });

  it('never processes a row twice under concurrent calls', async () => {
    const counting = createCountingProvider([], 5);

    setVisionProviderForTesting(counting.provider);

    const rosterId = await createRoster(admin, teamId);
    const processed: string[] = [];

    for (let round = 0; round < 6; round += 1) {
      const results = await Promise.all([
        extractNext(admin, teamId, rosterId).then(readExtract),
        extractNext(admin, teamId, rosterId).then(readExtract),
      ]);

      processed.push(...results.flatMap((result) => result.processedRowIds));

      if (results.every((result) => result.progress.phase === TeamRosterPhase.READY)) {
        break;
      }
    }

    expect(processed).toHaveLength(10);
    expect(new Set(processed).size).toBe(10);
    expect([...counting.callsByName.values()].every((count) => count === 1)).toBe(true);
    expect(counting.callsByName.size).toBe(10);
  });

  it('keeps failed rows aside and retries them on request, at most 3 attempts', async () => {
    const counting = createCountingProvider(['박지우']);

    setVisionProviderForTesting(counting.provider);

    const rosterId = await createRoster(admin, teamId);
    const done = await extractAll(admin, teamId, rosterId);

    expect(done.progress).toMatchObject({
      phase: TeamRosterPhase.READY,
      failed: 1,
      done: 9,
      retryableRowCount: 1,
    });

    const failedRowId = (await readRoster(admin, teamId, rosterId)).rows.find(
      (row) => row.displayName === '박지우',
    )?.id;

    // Without retryFailed the failed row is left alone.
    expect((await readExtract(await extractNext(admin, teamId, rosterId))).processedRowIds).toEqual([]);

    for (const attempt of [2, 3]) {
      const retried = await readExtract(await extractNext(admin, teamId, rosterId, { retryFailed: true }));

      expect(retried.processedRowIds).toEqual([failedRowId]);
      expect(retried.failedRows).toEqual([
        expect.objectContaining({
          rowId: failedRowId,
          attemptCount: attempt,
          errorCode: RecognitionErrorCode.PROVIDER_ERROR,
          retryable: attempt < 3,
        }),
      ]);
    }

    const exhausted = await readExtract(await extractNext(admin, teamId, rosterId, { retryFailed: true }));

    expect(exhausted.processedRowIds).toEqual([]);
    expect(exhausted.progress).toMatchObject({ failed: 1, retryableRowCount: 0 });
    expect(counting.callsByName.get('r3:박지우')).toBe(3);
  });

  it('resumes rows whose lease expired (closed browser) but not rows still leased', async () => {
    const rosterId = await createRoster(admin, teamId);

    await extractAll(admin, teamId, rosterId);

    const rows = await env.db.select().from(teamRosterRows).where(eq(teamRosterRows.rosterId, rosterId));
    const [stale, leased] = rows;

    await env.db
      .update(teamRosterRows)
      .set({
        extractStatus: RosterRowExtractStatus.PROCESSING,
        leaseExpiresAt: new Date(Date.now() - 1000),
        attemptCount: 1,
      })
      .where(eq(teamRosterRows.id, stale!.id));
    await env.db
      .update(teamRosterRows)
      .set({
        extractStatus: RosterRowExtractStatus.PROCESSING,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: 1,
      })
      .where(eq(teamRosterRows.id, leased!.id));

    const resumed = await readExtract(await extractNext(admin, teamId, rosterId));

    expect(resumed.processedRowIds).toEqual([stale!.id]);
    expect(resumed.progress).toMatchObject({ phase: TeamRosterPhase.EXTRACTING, processing: 1 });

    const [after] = await env.db
      .select()
      .from(teamRosterRows)
      .where(and(eq(teamRosterRows.rosterId, rosterId), eq(teamRosterRows.id, stale!.id)));

    expect(after?.attemptCount).toBe(2);
    expect(after?.extractStatus).toBe(RosterRowExtractStatus.DONE);
  });

  it('reports a first-pass failure as retryable', async () => {
    const rosterId = await createRoster(admin, teamId, { bytes: await createNarrowPng() });
    const failed = await readExtract(await extractNext(admin, teamId, rosterId));

    expect(failed.progress).toMatchObject({
      phase: TeamRosterPhase.RECOGNITION_FAILED,
      recognitionErrorCode: RecognitionErrorCode.NO_TABLE,
      retryable: true,
      total: 0,
    });
  });

  it('uses the recognized month when the upload does not give one', async () => {
    const rosterId = await createRoster(admin, teamId, {
      yearMonth: null,
      bytes: await createPngFixture(1600, 900),
    });

    await extractNext(admin, teamId, rosterId);

    const [roster] = await env.db.select().from(teamRosters).where(eq(teamRosters.id, rosterId));

    expect(roster?.yearMonth).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('roster upload jobs', () => {
  it('are not reachable through the personal recognition endpoints', async () => {
    const rosterId = await createRoster(admin, teamId);

    await extractNext(admin, teamId, rosterId);

    const [roster] = await env.db.select().from(teamRosters).where(eq(teamRosters.id, rosterId));
    const jobId = roster?.sourceJobId ?? '';

    expect((await requestCandidates(admin, jobId)).status).toBe(404);
  });
});

describe('editing rows during extraction', () => {
  it('refuses rows still being read and turns a failed row into a manual one', async () => {
    setVisionProviderForTesting(createCountingProvider(['이여름']).provider);

    const rosterId = await createRoster(admin, teamId);

    await extractNext(admin, teamId, rosterId);

    let roster = await readRoster(admin, teamId, rosterId);
    const pendingRow = roster.rows.find((row) => row.extractStatus === RosterRowExtractStatus.PENDING);
    const refused = await patchRoster(admin, teamId, rosterId, {
      version: roster.roster.version,
      rows: [{ rowId: pendingRow?.id, displayName: '고친 이름' }],
    });

    expect(refused.status).toBe(409);
    expect((await readJson<ApiErrorBody>(refused)).error.code).toBe(ApiErrorCode.ROSTER_NOT_EDITABLE);

    // Changing the month while people are being read would mix months: refused too.
    const monthChange = await patchRoster(admin, teamId, rosterId, {
      version: roster.roster.version,
      yearMonth: '2027-01',
    });

    expect(monthChange.status).toBe(409);

    await extractAll(admin, teamId, rosterId);
    roster = await readRoster(admin, teamId, rosterId);

    const failedRow = roster.rows.find((row) => row.extractStatus === RosterRowExtractStatus.FAILED);
    const patched = await patchRoster(admin, teamId, rosterId, {
      version: roster.roster.version,
      rows: [
        {
          rowId: failedRow?.id,
          entries: failedRow?.entries.map((entry) => ({
            ...entry,
            code: 'D',
            reviewReasons: [],
            confirmed: true,
          })),
        },
      ],
    });
    const after = await readJson<TeamRosterResponse>(patched);

    expect(patched.status).toBe(200);
    expect(after.rows.find((row) => row.id === failedRow?.id)?.extractStatus).toBe(
      RosterRowExtractStatus.MANUAL,
    );
    expect(after.progress.failed).toBe(0);
  });
});

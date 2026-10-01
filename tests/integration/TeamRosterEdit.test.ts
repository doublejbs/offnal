import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAX_ROSTER_ROWS } from '@/domain/DomainLimits';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type TeamRosterConflictDetails } from '@/domain/types/api/TeamRosterConflictDetails';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { teamRosterRows } from '@/server/db/Schema';
import { setVisionProviderForTesting } from '@/server/vision/VisionFactory';
import { type IntegrationEnvironment, readJson, setupIntegrationEnvironment } from '../helpers/ApiTestClient';
import { resolveEntries } from '../helpers/OffnalFlows';
import {
  createRoster,
  extractAll,
  extractNext,
  type InvitedTeam,
  patchRoster,
  readRoster,
  setupInvitedTeam,
} from '../helpers/TeamRosterFlows';

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  setVisionProviderForTesting(null);
});

afterAll(async () => {
  await env.close();
});

const setupTeam = (prefix: string): Promise<InvitedTeam> =>
  setupInvitedTeam(`${prefix} 관리자`, `${prefix} 병동`);

describe('roster PATCH', () => {
  it('rejects a stale version with 409 and the current roster', async () => {
    const team = await setupTeam('충돌');
    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    const current = await readRoster(team.admin, team.teamId, rosterId);
    const first = await patchRoster(team.admin, team.teamId, rosterId, {
      version: current.roster.version,
      rows: [{ rowId: current.rows[0]?.id, displayName: '김하루 수정' }],
    });

    expect(first.status).toBe(200);
    expect((await readJson<TeamRosterResponse>(first)).roster.version).toBe(current.roster.version + 1);

    const stale = await patchRoster(team.admin, team.teamId, rosterId, {
      version: current.roster.version,
      rows: [{ rowId: current.rows[1]?.id, excluded: true }],
    });
    const body = await readJson<ApiErrorBody>(stale);
    const details = body.error.details as TeamRosterConflictDetails;

    expect(stale.status).toBe(409);
    expect(body.error.code).toBe(ApiErrorCode.REVISION_CONFLICT);
    expect(details).toMatchObject({
      reason: RevisionConflictReason.STALE_REVISION,
      currentVersion: current.roster.version + 1,
    });
    expect(details.roster?.rows[0]?.displayName).toBe('김하루 수정');
    // The renamed row keeps its key.
    expect(details.roster?.rows[0]?.rowKey).toBe('김하루#1');
  });

  it('validates entries, definitions and new rows', async () => {
    const team = await setupTeam('검증');
    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    const current = await readRoster(team.admin, team.teamId, rosterId);
    const version = current.roster.version;

    expect(
      (
        await patchRoster(team.admin, team.teamId, rosterId, {
          version,
          rows: [{ rowId: current.rows[0]?.id, entries: current.rows[0]?.entries.slice(1) }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await patchRoster(team.admin, team.teamId, rosterId, {
          version,
          rows: [{ rowId: '00000000-0000-4000-8000-000000000000', excluded: true }],
        })
      ).status,
    ).toBe(400);

    const added = await patchRoster(team.admin, team.teamId, rosterId, {
      version,
      addRows: [{ displayName: '신규 입사자' }, { displayName: '김하루' }],
    });
    const roster = await readJson<TeamRosterResponse>(added);

    expect(added.status).toBe(200);
    // Nothing published yet, so no row counts as a "new person" compared with a previous revision.
    expect(
      roster.rows.slice(-2).map((row) => [row.rowKey, row.displayName, row.sameNameOrdinal, row.isNewPerson]),
    ).toEqual([
      ['신규입사자#1', '신규 입사자', 1, false],
      ['김하루#3', '김하루', 3, false],
    ]);
    expect(roster.rows.at(-1)?.reviewCount).toBe(30);
  });

  it('confirms codes outside the legend in every row once the roster defines them', async () => {
    const team = await setupTeam('정의');
    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    const current = await readRoster(team.admin, team.teamId, rosterId);
    // Confirm everything except codes outside the legend, then define those codes once for the whole roster.
    const partially = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, rosterId, {
        version: current.roster.version,
        rows: current.rows.map((row) => ({
          rowId: row.id,
          entries: resolveEntries(row.entries).map((entry, index) => {
            const original = row.entries[index];

            return original?.reviewReasons.length === 1 &&
              original.reviewReasons[0] === ShiftReviewReason.UNDEFINED_CODE
              ? original
              : entry;
          }),
        })),
      }),
    );

    expect(partially.publishable).toBe(false);

    const defined = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, rosterId, {
        version: partially.roster.version,
        definitions: partially.definitions.map((definition) =>
          definition.code === '연차'
            ? { ...definition, isOff: true }
            : definition.code === 'W'
              ? { ...definition, startTime: '09:00', endTime: '18:00', endsNextDay: false }
              : definition,
        ),
      }),
    );

    expect(defined.publishable).toBe(true);
  });
});

describe('roster PATCH writes', () => {
  it('updates only rows that changed and stores same-name ordinals in the same write', async () => {
    const team = await setupTeam('부분');
    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    const current = await readRoster(team.admin, team.teamId, rosterId);
    const target = current.rows[1];
    const before = await env.db.select().from(teamRosterRows).where(eq(teamRosterRows.rosterId, rosterId));

    // Renaming 이여름 (position 1) to 김하루 makes three 김하루 rows: only that row and the old second 김하루
    // (its ordinal moves from 2 to 3) are written; the other 8 rows are untouched.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await patchRoster(team.admin, team.teamId, rosterId, {
      version: current.roster.version,
      rows: [{ rowId: target?.id, displayName: '김하루' }],
    });

    expect(response.status).toBe(200);

    const after = await env.db.select().from(teamRosterRows).where(eq(teamRosterRows.rosterId, rosterId));
    const touched = after.filter(
      (row) => before.find((old) => old.id === row.id)?.updatedAt.getTime() !== row.updatedAt.getTime(),
    );

    const thirdKim = current.rows.find((row) => row.displayName === '김하루' && row.sameNameOrdinal === 2);

    expect(touched.map((row) => row.id).sort()).toEqual([target?.id, thirdKim?.id].sort());
    expect(
      after
        .filter((row) => row.displayName === '김하루')
        .sort((left, right) => left.position - right.position)
        .map((row) => [row.position, row.sameNameOrdinal]),
    ).toEqual([
      [0, 1],
      [1, 2],
      [3, 3],
    ]);
  });

  it('refuses adding people beyond the roster limit', async () => {
    const team = await setupTeam('인원');
    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    const current = await readRoster(team.admin, team.teamId, rosterId);
    const tooMany = Array.from({ length: MAX_ROSTER_ROWS - current.rows.length + 1 }, (_, index) => ({
      displayName: `추가${index}`,
    }));
    const refused = await patchRoster(team.admin, team.teamId, rosterId, {
      version: current.roster.version,
      addRows: tooMany,
    });

    expect(refused.status).toBe(400);

    const exact = await patchRoster(team.admin, team.teamId, rosterId, {
      version: current.roster.version,
      addRows: tooMany.slice(1),
    });

    expect((await readJson<TeamRosterResponse>(exact)).rows).toHaveLength(MAX_ROSTER_ROWS);
  });

  it('bumps the version when extraction adds legend codes, so a PATCH with the old legend gets 409', async () => {
    const team = await setupTeam('범례');
    const rosterId = await createRoster(team.admin, team.teamId);
    // First call: rows are created (no legend change yet besides pass 1) and 4 rows read, adding 연차/W.
    const beforeRead = await readRoster(team.admin, team.teamId, rosterId);

    await extractNext(team.admin, team.teamId, rosterId);

    const afterRead = await readRoster(team.admin, team.teamId, rosterId);

    expect(afterRead.definitions.map((definition) => definition.code)).toEqual(
      expect.arrayContaining(['연차', 'W']),
    );
    expect(afterRead.roster.version).toBeGreaterThan(beforeRead.roster.version);

    const stale = await patchRoster(team.admin, team.teamId, rosterId, {
      version: beforeRead.roster.version,
      definitions: afterRead.definitions.filter((definition) => definition.code !== 'W'),
    });

    expect(stale.status).toBe(409);
  });
});

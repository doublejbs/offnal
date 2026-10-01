import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type Db } from '@/server/db/Database';
import { recognitionJobs, teamRosterRows, teamRosters } from '@/server/db/Schema';
import { getRequestContext } from '@/server/http/RequestContext';
import { requireTeamAdmin } from '@/server/services/TeamAccess';
import {
  claimRows,
  type ClaimedRow,
  type RowOutcome,
  storeOutcome,
} from '@/server/services/TeamRosterRowLease';
import { buildEmptyMonth } from '@/server/services/TeamRosterRows';
import { uploadRoster } from '@/server/services/TeamRosterUploadService';
import { type IntegrationEnvironment, setupIntegrationEnvironment } from '../helpers/ApiTestClient';
import { requireValue } from '../helpers/TeamRosterAssertions';
import {
  createRoster,
  createTeamTablePng,
  extractNext,
  type InvitedTeam,
  setupInvitedTeam,
  TEAM_MONTH,
} from '../helpers/TeamRosterFlows';

let env: IntegrationEnvironment;
let team: InvitedTeam;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
  team = await setupInvitedTeam('펜스 관리자', '펜스 병동');
});

afterAll(async () => {
  await env.close();
});

/** A distinctive successful outcome (every date 'N', confirmed) so a stored write is easy to detect. */
const buildOutcome = (): RowOutcome => {
  const empty = buildEmptyMonth(TEAM_MONTH, []);

  return {
    ok: true,
    schedule: {
      ...empty,
      entries: empty.entries.map((entry) => ({ ...entry, code: 'N', reviewReasons: [], confirmed: true })),
    },
  };
};

/** Rows created and 4 read by the first extract-next; the remaining 6 are PENDING. Claims up to 4 of them. */
const claimFreshRows = async (): Promise<{ rosterId: string; claimed: ClaimedRow[] }> => {
  const rosterId = await createRoster(team.admin, team.teamId);

  await extractNext(team.admin, team.teamId, rosterId);

  return { rosterId, claimed: await claimRows(env.db, rosterId, new Date()) };
};

const readRow = async (rowId: string) =>
  requireValue((await env.db.select().from(teamRosterRows).where(eq(teamRosterRows.id, rowId)))[0], 'row');

const expireLease = async (rowId: string): Promise<void> => {
  await env.db
    .update(teamRosterRows)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(teamRosterRows.id, rowId));
};

describe('late extraction results are discarded', () => {
  it('stores a result while the lease is held', async () => {
    const { rosterId, claimed } = await claimFreshRows();
    const row = requireValue(claimed[0], 'claimed row');

    expect(await storeOutcome(env.db, rosterId, row, buildOutcome(), TEAM_MONTH)).toBe(true);
    expect((await readRow(row.id)).extractStatus).toBe(RosterRowExtractStatus.DONE);
  });

  it('(a) discards a result once the roster was published meanwhile', async () => {
    const { rosterId, claimed } = await claimFreshRows();
    const row = requireValue(claimed[0], 'claimed row');
    const before = await readRow(row.id);

    await env.db
      .update(teamRosters)
      .set({ status: TeamRosterStatus.PUBLISHED, revision: 99, publishedAt: new Date() })
      .where(eq(teamRosters.id, rosterId));

    expect(await storeOutcome(env.db, rosterId, row, buildOutcome(), TEAM_MONTH)).toBe(false);
    expect((await readRow(row.id)).entries).toEqual(before.entries);
  });

  it('(b) discards the earlier call once its lease expired and another call took the row over', async () => {
    const { rosterId, claimed } = await claimFreshRows();
    const first = requireValue(claimed[0], 'claimed row');

    await expireLease(first.id);

    const takeover = requireValue(
      (await claimRows(env.db, rosterId, new Date())).find((row) => row.id === first.id),
      'reclaimed row',
    );

    expect(takeover.attemptCount).toBe(first.attemptCount + 1);
    expect(await storeOutcome(env.db, rosterId, first, buildOutcome(), TEAM_MONTH)).toBe(false);
    expect(await storeOutcome(env.db, rosterId, takeover, buildOutcome(), TEAM_MONTH)).toBe(true);
  });

  it('discards a result whose lease expired even without a takeover', async () => {
    const { rosterId, claimed } = await claimFreshRows();
    const row = requireValue(claimed[0], 'claimed row');

    await expireLease(row.id);

    expect(await storeOutcome(env.db, rosterId, row, buildOutcome(), TEAM_MONTH)).toBe(false);
  });

  it('(c) discards a result after the admin turned the row into a MANUAL one', async () => {
    const { rosterId, claimed } = await claimFreshRows();
    const row = requireValue(claimed[0], 'claimed row');

    await env.db
      .update(teamRosterRows)
      .set({ extractStatus: RosterRowExtractStatus.MANUAL })
      .where(eq(teamRosterRows.id, row.id));

    expect(await storeOutcome(env.db, rosterId, row, buildOutcome(), TEAM_MONTH)).toBe(false);
    expect((await readRow(row.id)).extractStatus).toBe(RosterRowExtractStatus.MANUAL);
  });

  it('(d) requeues the row without spending the attempt when the month changed mid-read', async () => {
    const { rosterId, claimed } = await claimFreshRows();
    const row = requireValue(claimed[0], 'claimed row');

    expect(await storeOutcome(env.db, rosterId, row, buildOutcome(), '2027-02')).toBe(false);
    expect(await readRow(row.id)).toMatchObject({
      extractStatus: RosterRowExtractStatus.PENDING,
      attemptCount: row.attemptCount - 1,
    });
  });
});

describe('roster upload atomicity', () => {
  it('leaves neither a job nor the photo when the database step fails', async () => {
    const sourcesDir = path.join(env.storageDir, 'sources');
    const listSources = async (): Promise<string[]> => readdir(sourcesDir).catch(() => []);
    const context = await getRequestContext(team.admin.buildRequest('/api/teams'), env.db);
    const access = await requireTeamAdmin(env.db, context, team.teamId);
    const sourcesBefore = await listSources();
    const jobsBefore = await env.db.select({ id: recognitionJobs.id }).from(recognitionJobs);
    const countRosters = async (): Promise<number> =>
      (
        await env.db
          .select({ id: teamRosters.id })
          .from(teamRosters)
          .where(eq(teamRosters.teamId, team.teamId))
      ).length;
    const rostersBefore = await countRosters();
    // Every query works, but the transaction (job + roster insert) fails.
    const failingDb = new Proxy(env.db, {
      get: (target, property) => {
        if (property === 'transaction') {
          return async () => {
            throw new Error('database unavailable');
          };
        }

        const value: unknown = Reflect.get(target, property);

        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Db;

    await expect(
      uploadRoster(failingDb, access, {
        bytes: await createTeamTablePng(),
        yearMonth: TEAM_MONTH,
        authorityConfirmed: true,
      }),
    ).rejects.toThrow('database unavailable');

    expect(await listSources()).toEqual(sourcesBefore);
    expect(await env.db.select({ id: recognitionJobs.id }).from(recognitionJobs)).toHaveLength(
      jobsBefore.length,
    );
    expect(await countRosters()).toBe(rostersBefore);
  });
});

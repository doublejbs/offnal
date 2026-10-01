import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CreateRosterDraftResponse } from '@/domain/types/api/CreateRosterDraftResponse';
import { type PublishTeamRosterResponse } from '@/domain/types/api/PublishTeamRosterResponse';
import { type TeamMyMonthsResponse } from '@/domain/types/api/TeamMyMonthsResponse';
import { type TeamRosterConflictDetails } from '@/domain/types/api/TeamRosterConflictDetails';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type TeamRosterRowBlocker } from '@/domain/types/api/TeamRosterRowBlocker';
import { type TeamRosterViewResponse } from '@/domain/types/api/TeamRosterViewResponse';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { teamRosterChanges, teamRosters } from '@/server/db/Schema';
import { createMockVisionProvider } from '@/server/vision/MockVisionProvider';
import { setVisionProviderForTesting } from '@/server/vision/VisionFactory';
import { type IntegrationEnvironment, readJson, setupIntegrationEnvironment } from '../helpers/ApiTestClient';
import { findRowKey, requireValue } from '../helpers/TeamRosterAssertions';
import {
  createRoster,
  createRosterDraft,
  extractAll,
  getMyMonths,
  getRosterView,
  type InvitedTeam,
  joinAndApprove,
  patchRoster,
  publishReadyRoster,
  publishRoster,
  readRoster,
  resolveRoster,
  revertRoster,
  setupInvitedTeam,
  TEAM_MONTH,
  uploadAndPublishRoster,
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

const withCode = (entries: ShiftEntry[], changes: Record<string, string>): ShiftEntry[] =>
  entries.map((entry) => (changes[entry.date] ? { ...entry, code: changes[entry.date] ?? null } : entry));

const createDraftOf = async (team: InvitedTeam, rosterId: string): Promise<TeamRosterResponse> => {
  const response = await createRosterDraft(team.admin, team.teamId, rosterId);

  expect(response.status).toBe(200);

  const { rosterId: draftId } = await readJson<CreateRosterDraftResponse>(response);

  return readRoster(team.admin, team.teamId, draftId);
};

describe('publishing', () => {
  it('refuses rows that still need review (422) but ignores excluded rows', async () => {
    const team = await setupTeam('차단');
    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    const unresolved = await readRoster(team.admin, team.teamId, rosterId);
    const blocked = await publishRoster(team.admin, team.teamId, rosterId, unresolved.roster.version);
    const body = await readJson<ApiErrorBody>(blocked);
    const blockers = (body.error.details as { blockers: TeamRosterRowBlocker[] }).blockers;

    expect(blocked.status).toBe(422);
    expect(body.error.code).toBe(ApiErrorCode.PUBLISH_BLOCKED);
    expect(blockers).toHaveLength(10);
    expect(blockers[0]?.blockers.map((blocker) => blocker.reason)).toContain(
      PublishBlockReason.UNCONFIRMED_DATES,
    );

    // Resolve everyone except 윤소리, then exclude that row: publishable.
    const resolved = await resolveRoster(team.admin, team.teamId, rosterId, (row) =>
      row.displayName === '윤소리' ? { entries: row.entries } : {},
    );

    expect(resolved.blockers.map((blocker) => blocker.displayName)).toEqual(['윤소리']);
    expect((await publishRoster(team.admin, team.teamId, rosterId, resolved.roster.version)).status).toBe(
      422,
    );

    const yoon = resolved.rows.find((row) => row.displayName === '윤소리');
    const excluded = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, rosterId, {
        version: resolved.roster.version,
        rows: [{ rowId: requireValue(yoon?.id, 'yoon id'), excluded: true }],
      }),
    );

    expect(excluded.publishable).toBe(true);

    const published = await publishReadyRoster(team.admin, team.teamId, excluded);

    expect(published).toMatchObject({
      yearMonth: TEAM_MONTH,
      revision: 1,
      changedCellCount: 0,
      alreadyPublished: false,
    });

    const view = await readJson<TeamRosterViewResponse>(
      await getRosterView(team.admin, team.teamId, TEAM_MONTH),
    );

    expect(view.rows.map((row) => row.displayName)).not.toContain('윤소리');

    // Repeating the publish is idempotent.
    const again = await publishRoster(team.admin, team.teamId, rosterId, excluded.roster.version);

    expect((await readJson<PublishTeamRosterResponse>(again)).alreadyPublished).toBe(true);
  });

  it('publishes new revisions with exact change records and refuses stale drafts', async () => {
    const team = await setupTeam('변경');
    const first = await uploadAndPublishRoster(team.admin, team.teamId);
    const draft = await createDraftOf(team, first.rosterId);
    const staleDraft = await createDraftOf(team, first.rosterId);

    // The open copy of the same revision is reused.
    expect(staleDraft.roster.id).toBe(draft.roster.id);
    expect(draft.roster).toMatchObject({ status: TeamRosterStatus.DRAFT, baseRevision: 1 });
    expect(draft.publishable).toBe(true);

    const yeoreum = draft.rows.find((row) => row.displayName === '이여름');
    const changedEntries = withCode(yeoreum?.entries ?? [], { '2026-11-01': 'N', '2026-11-02': 'OFF' });
    const before = yeoreum?.entries.slice(0, 2).map((entry) => entry.code);
    const edited = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, draft.roster.id, {
        version: draft.roster.version,
        rows: [{ rowId: requireValue(yeoreum?.id, 'yeoreum id'), entries: changedEntries }],
      }),
    );

    expect(edited.changesPreview).toEqual({
      comparedRevision: 1,
      totalChangedCells: 2,
      rows: [
        {
          rowKey: '이여름#1',
          displayName: '이여름',
          changes: [
            { date: '2026-11-01', fromCode: before?.[0], toCode: 'N' },
            { date: '2026-11-02', fromCode: before?.[1], toCode: 'OFF' },
          ],
        },
      ],
    });

    // A competing photo upload made while revision 1 was current.
    const competingId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, competingId);

    const competing = await resolveRoster(team.admin, team.teamId, competingId);
    const second = await publishReadyRoster(team.admin, team.teamId, edited);

    expect(second).toMatchObject({ revision: 2, changedCellCount: 2 });

    const stored = await env.db
      .select()
      .from(teamRosterChanges)
      .where(eq(teamRosterChanges.rosterId, second.rosterId))
      .orderBy(asc(teamRosterChanges.date));

    expect(stored.map((change) => [change.rowKey, change.date, change.fromCode, change.toCode])).toEqual([
      ['이여름#1', '2026-11-01', before?.[0], 'N'],
      ['이여름#1', '2026-11-02', before?.[1], 'OFF'],
    ]);

    const statuses = await env.db
      .select({ id: teamRosters.id, status: teamRosters.status, revision: teamRosters.revision })
      .from(teamRosters)
      .where(eq(teamRosters.teamId, team.teamId));

    expect(statuses.find((row) => row.id === first.rosterId)).toMatchObject({
      status: TeamRosterStatus.ARCHIVED,
      revision: 1,
    });
    expect(statuses.find((row) => row.id === second.rosterId)).toMatchObject({
      status: TeamRosterStatus.PUBLISHED,
      revision: 2,
    });

    // The upload based on revision 1 can no longer be published over revision 2, and an archived
    // revision cannot be copied into a new draft (revert it instead).
    const refused = await publishRoster(team.admin, team.teamId, competingId, competing.roster.version);

    expect((await createRosterDraft(team.admin, team.teamId, first.rosterId)).status).toBe(409);

    expect(refused.status).toBe(409);
    expect(((await readJson<ApiErrorBody>(refused)).error.details as TeamRosterConflictDetails).reason).toBe(
      RevisionConflictReason.STALE_BASE,
    );

    // A new photo of the month matches people by row key: only 이여름's two cells differ from revision 2.
    const third = await uploadAndPublishRoster(team.admin, team.teamId);

    expect(third.roster.changesPreview?.totalChangedCells).toBe(2);
    expect(third.published).toMatchObject({ revision: 3, changedCellCount: 2 });

    // Revert: republish revision 2 as revision 4.
    const reverted = await revertRoster(team.admin, team.teamId, second.rosterId);
    const revertBody = await readJson<PublishTeamRosterResponse>(reverted);

    expect(reverted.status).toBe(200);
    expect(revertBody).toMatchObject({ revision: 4, changedCellCount: 2, alreadyPublished: false });

    const view = await readJson<TeamRosterViewResponse>(
      await getRosterView(team.admin, team.teamId, TEAM_MONTH),
    );

    expect(view.revision).toBe(4);
    expect(
      view.rows
        .find((row) => row.displayName === '이여름')
        ?.entries.slice(0, 2)
        .map((entry) => entry.code),
    ).toEqual(['N', 'OFF']);
    expect((await revertRoster(team.admin, team.teamId, revertBody.rosterId)).status).toBe(409);
  });

  it('keeps a linked member through a renamed row (matchRowKey) and through name fixes', async () => {
    const team = await setupTeam('이름');
    const first = await uploadAndPublishRoster(team.admin, team.teamId);
    const { member } = await joinAndApprove(env.db, team, '오하늘 본인', findRowKey(first.roster, '오하늘'));
    const base = createMockVisionProvider({ delayMs: 0 });

    setVisionProviderForTesting({
      ...base,
      recognizeTable: async (image, signal) => {
        const result = await base.recognizeTable(image, signal);

        return result.ok
          ? {
              ...result,
              value: {
                ...result.value,
                candidates: result.value.candidates.map((candidate) =>
                  candidate.name === '오하늘' ? { ...candidate, name: '오하늘빛' } : candidate,
                ),
              },
            }
          : result;
      },
    });

    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    const renamed = await readRoster(team.admin, team.teamId, rosterId);
    const newRow = renamed.rows.find((row) => row.displayName === '오하늘빛');

    expect(newRow).toMatchObject({ rowKey: '오하늘빛#1', isNewPerson: true });
    expect(renamed.unmatchedPreviousRows).toEqual([
      { rowKey: '오하늘#1', displayName: '오하늘', sameNameOrdinal: 1, sameNameCount: 1, linked: true },
    ]);

    // Publishing without the link would drop the linked member's month: refused until confirmed.
    const unresolvedLink = await resolveRoster(team.admin, team.teamId, rosterId);
    const blocked = await publishRoster(team.admin, team.teamId, rosterId, unresolvedLink.roster.version);
    const blockedBody = await readJson<ApiErrorBody>(blocked);

    expect(blocked.status).toBe(422);
    expect(blockedBody.error.details).toEqual({
      blockers: [],
      unlinkedRows: [
        { rowKey: '오하늘#1', displayName: '오하늘', sameNameOrdinal: 1, sameNameCount: 1, linked: true },
      ],
    });

    const matched = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, rosterId, {
        version: unresolvedLink.roster.version,
        rows: [{ rowId: requireValue(newRow?.id, 'new row id'), matchRowKey: '오하늘#1' }],
      }),
    );

    expect(matched.rows.find((row) => row.id === newRow?.id)).toMatchObject({
      rowKey: '오하늘#1',
      isNewPerson: false,
      displayName: '오하늘빛',
    });
    expect(matched.unmatchedPreviousRows).toEqual([]);
    expect(
      (
        await patchRoster(team.admin, team.teamId, rosterId, {
          version: matched.roster.version,
          rows: [{ rowId: requireValue(matched.rows[0]?.id, 'matched row 0 id'), matchRowKey: '오하늘#1' }],
        })
      ).status,
    ).toBe(400);

    const resolved = await resolveRoster(team.admin, team.teamId, rosterId);

    await publishReadyRoster(team.admin, team.teamId, resolved);

    const months = await readJson<TeamMyMonthsResponse>(await getMyMonths(member, team.teamId));

    expect(months.months.map((month) => [month.yearMonth, month.revision, month.displayName])).toEqual([
      [TEAM_MONTH, 2, '오하늘빛'],
    ]);
  });
});

describe('publish and revert protection', () => {
  it('answers alreadyPublished only for the current revision; an archived one is 409', async () => {
    const team = await setupTeam('보관');
    const first = await uploadAndPublishRoster(team.admin, team.teamId);
    const draft = await createDraftOf(team, first.rosterId);
    const yeoreum = requireValue(
      draft.rows.find((row) => row.displayName === '이여름'),
      '이여름 row',
    );
    const edited = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, draft.roster.id, {
        version: draft.roster.version,
        rows: [{ rowId: yeoreum.id, entries: withCode(yeoreum.entries, { '2026-11-03': 'N' }) }],
      }),
    );

    await publishReadyRoster(team.admin, team.teamId, edited);

    const archived = await publishRoster(
      team.admin,
      team.teamId,
      first.rosterId,
      first.roster.roster.version,
    );
    const body = await readJson<ApiErrorBody>(archived);

    expect(archived.status).toBe(409);
    expect(body.error.code).toBe(ApiErrorCode.ROSTER_NOT_EDITABLE);
  });

  it('refuses a revert that would drop a linked member unless confirmed', async () => {
    const team = await setupTeam('되돌림');
    const rosterId = await createRoster(team.admin, team.teamId);

    await extractAll(team.admin, team.teamId, rosterId);

    // Revision 1 without 오하늘 (excluded), revision 2 with 오하늘, then 오하늘 joins.
    const withoutOh = await resolveRoster(team.admin, team.teamId, rosterId, (row) =>
      row.displayName === '오하늘' ? { excluded: true } : {},
    );
    const first = await publishReadyRoster(team.admin, team.teamId, withoutOh);
    const draft = await createDraftOf(team, first.rosterId);
    const oh = requireValue(
      draft.rows.find((row) => row.displayName === '오하늘'),
      '오하늘 row',
    );
    const included = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, draft.roster.id, {
        version: draft.roster.version,
        rows: [{ rowId: oh.id, excluded: false }],
      }),
    );

    await publishReadyRoster(team.admin, team.teamId, included);
    await joinAndApprove(env.db, team, '되돌림 오하늘', oh.rowKey);

    const blocked = await revertRoster(team.admin, team.teamId, first.rosterId);
    const blockedBody = await readJson<ApiErrorBody>(blocked);

    expect(blocked.status).toBe(422);
    expect(blockedBody.error.details).toEqual({
      blockers: [],
      unlinkedRows: [
        { rowKey: oh.rowKey, displayName: '오하늘', sameNameOrdinal: 1, sameNameCount: 1, linked: true },
      ],
    });

    const confirmed = await revertRoster(team.admin, team.teamId, first.rosterId, { confirmUnlinked: true });

    expect(confirmed.status).toBe(200);
    expect((await readJson<PublishTeamRosterResponse>(confirmed)).revision).toBe(3);
  });
});

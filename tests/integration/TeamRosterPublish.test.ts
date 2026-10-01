import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
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
import { resolveEntries } from '../helpers/OffnalFlows';
import {
  createRoster,
  createRosterDraft,
  createTeam,
  extractAll,
  findRowKey,
  getMyMonths,
  getRosterView,
  issueInvite,
  joinAndApprove,
  loggedInClient,
  patchRoster,
  publishReadyRoster,
  publishRoster,
  type PublishedTeam,
  readRoster,
  resolveRoster,
  revertRoster,
  TEAM_MONTH,
  uploadAndPublishRoster,
} from '../helpers/TeamFlows';

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

const setupTeam = async (prefix: string): Promise<PublishedTeam> => {
  const admin = await loggedInClient(`${prefix} 관리자`);
  const { team } = await createTeam(admin, `${prefix} 병동`);
  const { token } = await issueInvite(admin, team.id);

  return { admin, teamId: team.id, rosterId: '', roster: {} as TeamRosterResponse, token };
};

const withCode = (entries: ShiftEntry[], changes: Record<string, string>): ShiftEntry[] =>
  entries.map((entry) => (changes[entry.date] ? { ...entry, code: changes[entry.date] ?? null } : entry));

const createDraftOf = async (team: PublishedTeam, rosterId: string): Promise<TeamRosterResponse> => {
  const response = await createRosterDraft(team.admin, team.teamId, rosterId);

  expect(response.status).toBe(200);

  const { rosterId: draftId } = await readJson<CreateRosterDraftResponse>(response);

  return readRoster(team.admin, team.teamId, draftId);
};

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
});

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
        rows: [{ rowId: yoon?.id, excluded: true }],
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
        rows: [{ rowId: yeoreum?.id, entries: changedEntries }],
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
    const { member } = await joinAndApprove(
      env.db,
      { ...team, rosterId: first.rosterId, roster: first.roster },
      '오하늘 본인',
      findRowKey(first.roster, '오하늘'),
    );
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
      { rowKey: '오하늘#1', displayName: '오하늘', linked: true },
    ]);

    // Publishing without the link would drop the linked member's month: refused until confirmed.
    const unresolvedLink = await resolveRoster(team.admin, team.teamId, rosterId);
    const blocked = await publishRoster(team.admin, team.teamId, rosterId, unresolvedLink.roster.version);
    const blockedBody = await readJson<ApiErrorBody>(blocked);

    expect(blocked.status).toBe(422);
    expect(blockedBody.error.details).toEqual({
      blockers: [],
      unlinkedRows: [{ rowKey: '오하늘#1', displayName: '오하늘', linked: true }],
    });

    const matched = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, rosterId, {
        version: unresolvedLink.roster.version,
        rows: [{ rowId: newRow?.id, matchRowKey: '오하늘#1' }],
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
          rows: [{ rowId: matched.rows[0]?.id, matchRowKey: '오하늘#1' }],
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

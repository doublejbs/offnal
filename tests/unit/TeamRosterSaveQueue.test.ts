import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/client/ApiClient';
import { applyEdits, mergeEdits, toPatchBody, validateEdits } from '@/client/TeamRosterEdits';
import { createRosterSaveQueue } from '@/client/TeamRosterSaveQueue';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';

import { buildEntries, buildRoster, buildRow, DEFINITIONS } from './support/RosterUiFixture';

type Call = {
  body: PatchTeamRosterRequest;
  resolve: (value: TeamRosterResponse) => void;
  reject: (error: unknown) => void;
};

const setup = () => {
  const calls: Call[] = [];
  const states: DraftSaveState[] = [];
  const onSaved = vi.fn();
  const onConflict = vi.fn();
  const queue = createRosterSaveQueue({
    send: (body) =>
      new Promise<TeamRosterResponse>((resolve, reject) => {
        calls.push({ body, resolve, reject });
      }),
    onSaved,
    onConflict,
    onStateChange: (state) => states.push(state),
  });

  queue.reset(5);

  return { queue, calls, states, onSaved, onConflict };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TeamRosterEdits', () => {
  it('merges edits field by field and builds the PATCH body', () => {
    const merged = mergeEdits(
      { rows: { r1: { displayName: '김하루 ' } } },
      { definitions: DEFINITIONS, rows: { r1: { excluded: true }, r2: { displayName: '이소망' } } },
    );

    expect(toPatchBody(7, merged)).toEqual({
      version: 7,
      definitions: DEFINITIONS,
      rows: [
        { rowId: 'r1', displayName: '김하루', excluded: true },
        { rowId: 'r2', displayName: '이소망' },
      ],
    });
  });

  it('applies a new definition to every row like the server (resolveDefinedCodes)', () => {
    const waiting = {
      date: '2026-11-02',
      code: 'W',
      reviewReasons: [ShiftReviewReason.UNDEFINED_CODE],
      confirmed: false,
    };
    const roster = buildRoster([
      buildRow('r1', '김하루', { entries: buildEntries('D', { 2: waiting }), reviewCount: 1 }),
    ]);
    const withW = [
      ...DEFINITIONS,
      { code: 'W', label: '교육', startTime: null, endTime: null, endsNextDay: null, isOff: true },
    ];
    const view = applyEdits(roster, { definitions: withW, rows: {} });

    expect(view.rows[0]!.reviewCount).toBe(0);
    expect(view.rows[0]!.entries[1]).toMatchObject({ code: 'W', confirmed: true });
  });

  it('rejects empty names before sending', () => {
    expect(validateEdits({ rows: { r1: { displayName: '  ' } } })).toBe('이름을 입력해 주세요.');
    expect(validateEdits({ rows: { r1: { excluded: true } } })).toBeNull();
  });
});

describe('TeamRosterSaveQueue', () => {
  it('sends pending edits with the current version and follows the server version', async () => {
    const { queue, calls, onSaved } = setup();

    queue.edit({ rows: { r1: { excluded: true } } });

    const flushed = queue.flush();

    await tick();
    expect(calls[0]!.body).toEqual({ version: 5, rows: [{ rowId: 'r1', excluded: true }] });
    calls[0]!.resolve(buildRoster([], 6));
    await expect(flushed).resolves.toBe(true);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(queue.getVersion()).toBe(6);
    expect(queue.isDirty()).toBe(false);
  });

  it('keeps edits made during a save for the next PATCH and shows them locally', async () => {
    const { queue, calls } = setup();

    queue.edit({ rows: { r1: { displayName: '가' } } });

    const first = queue.flush();

    await tick();
    queue.edit({ rows: { r1: { displayName: '나' } } });
    expect(queue.getLocalEdits().rows.r1).toEqual({ displayName: '나' });
    calls[0]!.resolve(buildRoster([], 6));
    await expect(first).resolves.toBe(false);

    const second = queue.flush();

    await tick();
    expect(calls[1]!.body).toEqual({ version: 6, rows: [{ rowId: 'r1', displayName: '나' }] });
    calls[1]!.resolve(buildRoster([], 7));
    await expect(second).resolves.toBe(true);
  });

  it('on 409 drops local edits and hands over the latest roster', async () => {
    const { queue, calls, onConflict, states } = setup();
    const latest = buildRoster([], 9);

    queue.edit({ rows: { r1: { excluded: true } } });

    const flushed = queue.flush();

    await tick();
    calls[0]!.reject(new ApiClientError(409, ApiErrorCode.REVISION_CONFLICT, '...', { roster: latest }));
    await expect(flushed).resolves.toBe(false);
    expect(onConflict).toHaveBeenCalledWith(latest);
    expect(states.at(-1)).toBe(DraftSaveState.CONFLICT);
    expect(queue.isDirty()).toBe(false);
    expect(queue.getVersion()).toBe(9);
  });

  it('keeps edits after a network failure so "다시 저장" can resend them', async () => {
    const { queue, calls, states } = setup();

    queue.edit({ rows: { r1: { excluded: true } } });

    const flushed = queue.flush();

    await tick();
    calls[0]!.reject(new ApiClientError(0, null, '네트워크'));
    await expect(flushed).resolves.toBe(false);
    expect(states.at(-1)).toBe(DraftSaveState.ERROR);
    expect(queue.isDirty()).toBe(true);
  });

  it('drops edits the server can never accept (ROSTER_NOT_EDITABLE) and asks for a reload', async () => {
    const { queue, calls, onConflict, states } = setup();

    queue.edit({ rows: { r1: { excluded: true } } });

    const flushed = queue.flush();

    await tick();
    calls[0]!.reject(new ApiClientError(409, ApiErrorCode.ROSTER_NOT_EDITABLE, '이미 배포했어요'));
    await expect(flushed).resolves.toBe(false);
    expect(onConflict).toHaveBeenCalledWith(null);
    expect(states.at(-1)).toBe(DraftSaveState.ERROR);
    expect(queue.isDirty()).toBe(false);
  });

  it('runs an immediate PATCH after pending edits', async () => {
    const { queue, calls } = setup();

    queue.edit({ rows: { r1: { excluded: true } } });

    const result = queue.run({ addRows: [{ displayName: '신입' }] });

    await tick();
    calls[0]!.resolve(buildRoster([], 6));
    await tick();
    expect(calls[1]!.body).toEqual({ version: 6, addRows: [{ displayName: '신입' }] });
    calls[1]!.resolve(buildRoster([], 7));
    await expect(result).resolves.toMatchObject({ roster: { version: 7 } });
  });
});

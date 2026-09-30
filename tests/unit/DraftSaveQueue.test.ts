import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/client/ApiClient';
import { createDraftSaveQueue, type LocalDraft } from '@/client/DraftSaveQueue';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PatchDraftRequest } from '@/domain/types/api/PatchDraftRequest';

const draft = (displayName: string, yearMonth = '2026-10'): LocalDraft => ({
  displayName,
  yearMonth,
  entries: [],
  definitions: [
    { code: 'D', label: '데이', startTime: null, endTime: null, endsNextDay: null, isOff: false },
  ],
});

const responseFor = (revision: number, yearMonth = '2026-10'): DraftResponse =>
  ({ draft: { revision, yearMonth } }) as unknown as DraftResponse;

type Deferred = { resolve: (value: DraftResponse) => void; reject: (error: unknown) => void };

/** A fake PATCH whose calls resolve only when the test says so. */
const createServer = () => {
  const calls: { body: PatchDraftRequest; deferred: Deferred }[] = [];
  const send = vi.fn(
    (body: PatchDraftRequest) =>
      new Promise<DraftResponse>((resolve, reject) => {
        calls.push({ body, deferred: { resolve, reject } });
      }),
  );

  return { calls, send };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (initialRevision = 3) => {
  const server = createServer();
  const states: DraftSaveState[] = [];
  const onSaved = vi.fn();
  const queue = createDraftSaveQueue({
    send: server.send,
    onSaved,
    onStateChange: (state) => states.push(state),
  });

  queue.reset(initialRevision);

  return { queue, server, states, onSaved };
};

describe('DraftSaveQueue', () => {
  it('flush is a no-op (and clean) when nothing changed', async () => {
    const { queue, server } = setup();

    await expect(queue.flush()).resolves.toBe(true);
    expect(server.send).not.toHaveBeenCalled();
  });

  it('sends the latest snapshot with the current revision and propagates the new revision', async () => {
    const { queue, server, onSaved } = setup(3);

    queue.markDirty(draft('가'));
    queue.markDirty(draft(' 김하루 '));

    const flushed = queue.flush();

    await tick();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]?.body).toMatchObject({ revision: 3, displayName: '김하루' });
    server.calls[0]?.deferred.resolve(responseFor(4));
    await expect(flushed).resolves.toBe(true);
    expect(queue.getRevision()).toBe(4);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('serializes saves: an edit made during a save is sent after it, with the next revision', async () => {
    const { queue, server } = setup(1);

    queue.markDirty(draft('첫 번째'));

    const first = queue.flush();

    await tick();
    queue.markDirty(draft('두 번째'));

    const second = queue.flush();

    await tick();
    // The second PATCH must wait for the first response (never two in flight).
    expect(server.calls).toHaveLength(1);
    server.calls[0]?.deferred.resolve(responseFor(2));
    await expect(first).resolves.toBe(false);
    await tick();
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]?.body).toMatchObject({ revision: 2, displayName: '두 번째' });
    server.calls[1]?.deferred.resolve(responseFor(3));
    await expect(second).resolves.toBe(true);
    expect(queue.getRevision()).toBe(3);
  });

  it('stops saving after a 409 until reset, and keeps the edit dirty', async () => {
    const { queue, server, states } = setup(5);

    queue.markDirty(draft('충돌'));

    const flushed = queue.flush();

    await tick();
    server.calls[0]?.deferred.reject(new ApiClientError(409, ApiErrorCode.REVISION_CONFLICT, 'conflict'));
    await expect(flushed).resolves.toBe(false);
    expect(states.at(-1)).toBe(DraftSaveState.CONFLICT);
    expect(queue.hasConflict()).toBe(true);
    expect(queue.isDirty()).toBe(true);

    queue.markDirty(draft('또 수정'));
    await expect(queue.flush()).resolves.toBe(false);
    expect(server.send).toHaveBeenCalledTimes(1);

    queue.reset(7);
    expect(queue.hasConflict()).toBe(false);
    expect(queue.isDirty()).toBe(false);
    expect(queue.getRevision()).toBe(7);
  });

  it('keeps the edit and reports an error on other failures, retrying on the next flush', async () => {
    const { queue, server, states } = setup(1);

    queue.markDirty(draft('네트워크'));

    const failed = queue.flush();

    await tick();
    server.calls[0]?.deferred.reject(new ApiClientError(0, null, 'offline'));
    await expect(failed).resolves.toBe(false);
    expect(states.at(-1)).toBe(DraftSaveState.ERROR);

    const retried = queue.flush();

    await tick();
    expect(server.calls[1]?.body).toMatchObject({ revision: 1, displayName: '네트워크' });
    server.calls[1]?.deferred.resolve(responseFor(2));
    await expect(retried).resolves.toBe(true);
  });

  it('does not send invalid input (empty name) and reports INVALID', async () => {
    const { queue, server, states } = setup();

    queue.markDirty(draft('  '));
    await expect(queue.flush()).resolves.toBe(false);
    expect(server.send).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe(DraftSaveState.INVALID);
  });

  it('patch() flushes pending edits first, then sends its body with the propagated revision', async () => {
    const { queue, server } = setup(1);

    queue.markDirty(draft('먼저 저장'));

    const patched = queue.patch({ yearMonth: '2026-11' });

    await tick();
    expect(server.calls[0]?.body).toMatchObject({ revision: 1, displayName: '먼저 저장' });
    server.calls[0]?.deferred.resolve(responseFor(2));
    await tick();
    expect(server.calls[1]?.body).toEqual({ yearMonth: '2026-11', revision: 2 });
    server.calls[1]?.deferred.resolve(responseFor(3, '2026-11'));
    await expect(patched).resolves.toMatchObject({ draft: { revision: 3, yearMonth: '2026-11' } });
    expect(queue.getRevision()).toBe(3);
  });

  it('patch() rejects without sending when pending edits could not be saved', async () => {
    const { queue, server } = setup(1);

    queue.markDirty(draft(''));
    await expect(queue.patch({ yearMonth: '2026-11' })).rejects.toThrow();
    expect(server.send).not.toHaveBeenCalled();
  });
});

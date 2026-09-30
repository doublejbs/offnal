import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { MOCK_UNDEFINED_CODE_DAYS } from '@/domain/MockFixtureDays';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import {
  createLoggedInJob,
  defineMockUndefinedCodes,
  extractRow,
  patchDraft,
  publishDraft,
  readDraft,
  resolveEntries,
} from '../helpers/OffnalFlows';

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterAll(async () => {
  await env.close();
});

const YEAR_MONTH = '2026-11';

const dateOf = (day: number): string => `${YEAR_MONTH}-${String(day).padStart(2, '0')}`;

const UNDEFINED_DATES = Object.keys(MOCK_UNDEFINED_CODE_DAYS).map((day) => dateOf(Number(day)));

/** Spec §16: a code outside the legend is kept as read and confirmed by defining it once. */
describe('codes outside the legend', () => {
  it('keeps the code, then one definition PATCH confirms every date that uses it', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '범례 밖 코드 사용자');
    const draftId = await extractRow(client, jobId, YEAR_MONTH);
    const draft = await readDraft(client, draftId);

    for (const [day, code] of Object.entries(MOCK_UNDEFINED_CODE_DAYS)) {
      expect(draft.draft.entries.find((entry) => entry.date === dateOf(Number(day)))).toEqual({
        date: dateOf(Number(day)),
        code,
        reviewReasons: [ShiftReviewReason.UNDEFINED_CODE],
        confirmed: false,
      });
      expect(draft.draft.definitions.find((definition) => definition.code === code)).toMatchObject({
        startTime: null,
        endTime: null,
        isOff: false,
      });
    }

    expect(draft.review.dates).toEqual(expect.arrayContaining(UNDEFINED_DATES));
    expect(draft.blockers).toContainEqual({ reason: PublishBlockReason.MISSING_TIMES, codes: ['W', '연차'] });

    const response = await patchDraft(client, draftId, {
      revision: draft.draft.revision,
      definitions: defineMockUndefinedCodes(draft.draft.definitions),
    });
    const patched = await readJson<DraftResponse>(response);

    expect(response.status).toBe(200);

    for (const date of UNDEFINED_DATES) {
      expect(patched.draft.entries.find((entry) => entry.date === date)).toMatchObject({
        reviewReasons: [],
        confirmed: true,
      });
    }

    expect(patched.review.dates.some((date) => UNDEFINED_DATES.includes(date))).toBe(false);
    expect(patched.blockers.map((blocker) => blocker.reason)).toEqual([PublishBlockReason.UNCONFIRMED_DATES]);
    expect((await readDraft(client, draftId)).draft.entries).toEqual(patched.draft.entries);

    const resolved = await patchDraft(client, draftId, {
      revision: patched.draft.revision,
      entries: resolveEntries(patched.draft.entries),
    });
    const ready = await readJson<DraftResponse>(resolved);

    expect(ready.blockers).toEqual([]);
    expect((await publishDraft(client, draftId, ready.draft.revision)).status).toBe(200);
  });

  it('keeps dates unconfirmed while the definition is incomplete (no next-day flag)', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '범례 밖 코드 미완성');
    const draftId = await extractRow(client, jobId, YEAR_MONTH);
    const draft = await readDraft(client, draftId);
    const response = await patchDraft(client, draftId, {
      revision: draft.draft.revision,
      definitions: draft.draft.definitions.map((definition) =>
        definition.code === 'W' ? { ...definition, startTime: '09:00', endTime: '18:00' } : definition,
      ),
    });
    const patched = await readJson<DraftResponse>(response);

    expect(response.status).toBe(200);
    expect(patched.draft.entries.filter((entry) => UNDEFINED_DATES.includes(entry.date))).toEqual(
      draft.draft.entries.filter((entry) => UNDEFINED_DATES.includes(entry.date)),
    );
  });
});

import { describe, expect, it } from 'vitest';

import { AnalyticsSubjectKind } from '@/domain/enums/AnalyticsSubjectKind';
import { ANALYTICS_KEY_LENGTH, buildActorKey, buildSubjectKey } from '@/server/analytics/AnalyticsKeys';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const USER_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';

describe('analytics pseudonymous keys', () => {
  it('is a stable 32-char hex HMAC per id', () => {
    const key = buildActorKey(USER_ID, SECRET);

    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toHaveLength(ANALYTICS_KEY_LENGTH);
    expect(buildActorKey(USER_ID, SECRET)).toBe(key);
  });

  it('never contains the original id', () => {
    const key = buildActorKey(USER_ID, SECRET);
    const compactId = USER_ID.replace(/-/g, '');

    expect(key).not.toContain(USER_ID);
    expect(key).not.toContain(compactId.slice(0, 8));
    expect(compactId).not.toContain(key.slice(0, 8));
  });

  it('separates namespaces: the same id is a different key per kind', () => {
    const keys = new Set([
      buildActorKey(USER_ID, SECRET),
      buildSubjectKey({ kind: AnalyticsSubjectKind.JOB, id: USER_ID }, SECRET),
      buildSubjectKey({ kind: AnalyticsSubjectKind.CALENDAR, id: USER_ID }, SECRET),
      buildSubjectKey({ kind: AnalyticsSubjectKind.TEAM, id: USER_ID }, SECRET),
    ]);

    expect(keys.size).toBe(4);
  });

  it('depends on the secret (not a plain hash of the id)', () => {
    expect(buildActorKey(USER_ID, SECRET)).not.toBe(buildActorKey(USER_ID, `${SECRET}-other`));
  });
});

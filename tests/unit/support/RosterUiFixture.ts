import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { listDates } from '@/domain/YearMonth';

/** Client-side roster fixtures (admin review screen) for unit tests. */

export const YEAR_MONTH = '2026-11';

export const DEFINITIONS: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: '07:00', endTime: '15:00', endsNextDay: false, isOff: false },
  { code: 'E', label: '이브닝', startTime: '15:00', endTime: '23:00', endsNextDay: false, isOff: false },
  { code: 'N', label: '나이트', startTime: '23:00', endTime: '07:00', endsNextDay: true, isOff: false },
  { code: 'OFF', label: '휴무', startTime: null, endTime: null, endsNextDay: null, isOff: true },
];

/** Every date confirmed with `code`, except the listed overrides. */
export const buildEntries = (
  code: string | null,
  overrides: Partial<Record<number, ShiftEntry>> = {},
): ShiftEntry[] =>
  listDates(YEAR_MONTH).map(
    (date, index) => overrides[index + 1] ?? { date, code, reviewReasons: [], confirmed: code !== null },
  );

export const buildRow = (
  id: string,
  displayName: string,
  patch: Partial<TeamRosterRowDto> = {},
): TeamRosterRowDto => ({
  id,
  rowKey: `${displayName}#1`,
  displayName,
  sameNameOrdinal: 1,
  sameNameCount: 1,
  position: 0,
  entries: buildEntries('D'),
  sourceCells: [],
  excluded: false,
  extractStatus: RosterRowExtractStatus.DONE,
  attemptCount: 1,
  extractErrorCode: null,
  reviewCount: 0,
  blockers: [],
  linkedMember: null,
  isNewPerson: false,
  ...patch,
});

export const buildProgress = (patch: Partial<TeamRosterProgress> = {}): TeamRosterProgress => ({
  phase: TeamRosterPhase.READY,
  total: 3,
  done: 3,
  manual: 0,
  failed: 0,
  pending: 0,
  processing: 0,
  excluded: 0,
  recognitionErrorCode: null,
  retryable: false,
  retryableRowCount: 0,
  ...patch,
});

export const buildRoster = (rows: TeamRosterRowDto[], version = 5): TeamRosterResponse => ({
  roster: {
    id: '00000000-0000-4000-8000-000000000001',
    teamId: '00000000-0000-4000-8000-000000000002',
    yearMonth: YEAR_MONTH,
    status: TeamRosterStatus.DRAFT,
    revision: null,
    baseRevision: 0,
    version,
    createdAt: '2026-10-01T00:00:00.000Z',
    publishedAt: null,
    authorityConfirmedAt: '2026-10-01T00:00:00.000Z',
    fromUpload: true,
    sourceAvailable: true,
  },
  progress: buildProgress({ total: rows.length, done: rows.length }),
  definitions: DEFINITIONS,
  rows,
  blockers: [],
  publishable: true,
  latestPublishedRevision: 0,
  unmatchedPreviousRows: [],
  changesPreview: null,
});

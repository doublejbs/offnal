/**
 * Deterministic mock recognition fixture shared by MockVisionProvider, integration helpers and E2E (no
 * server-only imports, so Playwright can load it). Codes written in cells but not in the legend
 * (Spec §16): kept as read, flagged UNDEFINED_CODE, same days for every row.
 */
export const MOCK_LEAVE_CODE = '연차';

export const MOCK_WORK_CODE_OUTSIDE_LEGEND = 'W';

export const MOCK_UNDEFINED_CODE_DAYS: Readonly<Record<number, string>> = {
  3: MOCK_LEAVE_CODE,
  25: MOCK_WORK_CODE_OUTSIDE_LEGEND,
};

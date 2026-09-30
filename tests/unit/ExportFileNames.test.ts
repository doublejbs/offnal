import { describe, expect, it } from 'vitest';

import {
  buildIcsFileName,
  buildPngFileName,
  buildSharedIcsFileName,
  buildSharedPngFileName,
} from '@/domain/ExportFileNames';

describe('ExportFileNames', () => {
  it('names the owner files offnal-YYYY-MM', () => {
    expect(buildIcsFileName('2026-10')).toBe('offnal-2026-10.ics');
    expect(buildPngFileName('2026-10')).toBe('offnal-2026-10.png');
  });

  it('names the share-link recipient files offnal-shared-YYYY-MM without the display name', () => {
    expect(buildSharedIcsFileName('2026-10')).toBe('offnal-shared-2026-10.ics');
    expect(buildSharedPngFileName('2026-10')).toBe('offnal-shared-2026-10.png');
  });
});

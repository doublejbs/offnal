import { parseArgs } from 'node:util';

import { gte } from 'drizzle-orm';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { DbDriver } from '@/domain/enums/DbDriver';
import { createDbHandleFromEnv } from '@/server/db/Database';
import { ocrShadowRuns } from '@/server/db/Schema';
import { formatShadowSummary, summarizeShadowRuns } from '@/server/vision/ocr/OcrShadowStats';

const DEFAULT_DAYS = 7;
const MEMORY_PGLITE_DIR = 'memory';

const readDays = (): number => {
  // `pnpm ocr:shadow-report -- --days 7` forwards the `--` separator too.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const { values } = parseArgs({ args, options: { days: { type: 'string' } } });
  const days = values.days === undefined ? DEFAULT_DAYS : Number(values.days);

  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('--days must be a positive integer');
  }

  return days;
};

/** `pnpm ocr:shadow-report [--days N]`: aggregates the last N days of `ocr_shadow_runs` (Spec §21-6). */
const runShadowReport = async (): Promise<void> => {
  const days = readDays();
  const handle = createDbHandleFromEnv();

  // A file-backed PGlite directory must not be opened while the dev server holds it (as in db:check).
  if (handle.driver === DbDriver.PGLITE && handle.target !== MEMORY_PGLITE_DIR) {
    console.info('[ocr:shadow-report] 로컬 PGlite는 열지 않습니다. DATABASE_URL을 설정하세요.');
    await handle.close();

    return;
  }

  try {
    if (handle.driver === DbDriver.PGLITE) {
      // In-memory PGlite (tests, local check): empty, so migrate to read an empty report.
      await handle.migrate();
    }

    const rows = await handle.db
      .select({
        status: ocrShadowRuns.status,
        wouldFallback: ocrShadowRuns.wouldFallback,
        reviewCells: ocrShadowRuns.reviewCells,
        disagreeCells: ocrShadowRuns.disagreeCells,
        ocrMs: ocrShadowRuns.ocrMs,
        rssMb: ocrShadowRuns.rssMb,
        coldStart: ocrShadowRuns.coldStart,
      })
      .from(ocrShadowRuns)
      .where(gte(ocrShadowRuns.createdAt, new Date(Date.now() - days * MS_PER_DAY)));

    console.info(formatShadowSummary(summarizeShadowRuns(rows), days));
  } finally {
    await handle.close();
  }
};

runShadowReport().catch((error: unknown) => {
  console.error('[ocr:shadow-report] 실패', { name: error instanceof Error ? error.name : typeof error });
  process.exitCode = 1;
});

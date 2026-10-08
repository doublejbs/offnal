import { parseArgs } from 'node:util';

import { DbDriver } from '@/domain/enums/DbDriver';
import { collectAnalyticsReport } from '@/server/analytics/AnalyticsReportQueries';
import { formatAnalyticsReport } from '@/server/analytics/AnalyticsStats';
import { createDbHandleFromEnv } from '@/server/db/Database';

const DEFAULT_DAYS = 30;
const MEMORY_PGLITE_DIR = 'memory';

const readDays = (): number => {
  // `pnpm analytics:report -- --days 30` forwards the `--` separator too.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const { values } = parseArgs({ args, options: { days: { type: 'string' } } });
  const days = values.days === undefined ? DEFAULT_DAYS : Number(values.days);

  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('--days must be a positive integer');
  }

  return days;
};

/** `pnpm analytics:report [--days N]`: Spec §23.5 metrics of the last N days of `analytics_events`. */
const runAnalyticsReport = async (): Promise<void> => {
  const days = readDays();
  const handle = createDbHandleFromEnv();

  // A file-backed PGlite directory must not be opened while the dev server holds it (as in db:check).
  if (handle.driver === DbDriver.PGLITE && handle.target !== MEMORY_PGLITE_DIR) {
    console.info('[analytics:report] 로컬 PGlite는 열지 않습니다. DATABASE_URL을 설정하세요.');
    await handle.close();

    return;
  }

  try {
    if (handle.driver === DbDriver.PGLITE) {
      // In-memory PGlite (tests, local check): empty, so migrate to read an empty report.
      await handle.migrate();
    }

    console.info(formatAnalyticsReport(await collectAnalyticsReport(handle.db, { days, now: new Date() })));
  } finally {
    await handle.close();
  }
};

runAnalyticsReport().catch((error: unknown) => {
  console.error('[analytics:report] 실패', { name: error instanceof Error ? error.name : typeof error });
  process.exitCode = 1;
});

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { DbDriver } from '@/domain/enums/DbDriver';
import { createDbHandleFromEnv } from '@/server/db/Database';
import {
  countAppliedMigrations,
  listAppTableRowSecurity,
  listPublicRoleAccessibleTables,
} from '@/server/db/DatabaseInspection';

const MEMORY_PGLITE_DIR = 'memory';

const journalSchema = z.object({ entries: z.array(z.object({ tag: z.string() })) });

const readJournalCount = async (): Promise<number> => {
  const raw = await readFile(path.join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8');

  return journalSchema.parse(JSON.parse(raw)).entries.length;
};

/** `pnpm db:check`: connects with DATABASE_URL (no password printed), migration count, RLS on every app table. */
const runDbCheck = async (): Promise<void> => {
  const handle = createDbHandleFromEnv();

  console.info(`[db:check] 대상: ${handle.driver} (${handle.target})`);

  // A file-backed PGlite directory must not be opened while the dev server holds it.
  if (handle.driver === DbDriver.PGLITE && handle.target !== MEMORY_PGLITE_DIR) {
    console.info(
      '[db:check] 로컬 PGlite는 개발 서버와 동시에 열지 않기 위해 검사하지 않습니다. DATABASE_URL을 설정하세요.',
    );
    await handle.close();

    return;
  }

  try {
    // Sequential: node-postgres pools may run these in parallel, PGlite has a single connection anyway.
    const applied = await countAppliedMigrations(handle.db);
    const expected = await readJournalCount();
    const tables = await listAppTableRowSecurity(handle.db);
    const exposed = await listPublicRoleAccessibleTables(handle.db);
    const withoutRls = tables.filter((table) => !table.rowSecurity).map((table) => table.name);

    console.info(`[db:check] 마이그레이션: 적용 ${applied ?? 0} / 저장소 ${expected}`);
    console.info(
      `[db:check] 앱 테이블 ${tables.length}개, RLS 미적용: ${withoutRls.length === 0 ? '없음' : withoutRls.join(', ')}`,
    );

    console.info(
      `[db:check] anon/authenticated 테이블 권한: ${
        exposed === null
          ? '해당 역할 없음(Supabase 아님)'
          : exposed.length === 0
            ? '없음'
            : exposed.join(', ')
      }`,
    );

    if (applied !== expected || withoutRls.length > 0 || tables.length === 0 || (exposed?.length ?? 0) > 0) {
      console.error('[db:check] 확인 필요: `pnpm db:migrate`로 마이그레이션을 적용하세요.');
      process.exitCode = 1;

      return;
    }

    console.info('[db:check] 성공');
  } finally {
    await handle.close();
  }
};

runDbCheck().catch((error: unknown) => {
  console.error('[db:check] 실패', {
    name: error instanceof Error ? error.name : typeof error,
    code: (error as { code?: unknown } | null)?.code,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

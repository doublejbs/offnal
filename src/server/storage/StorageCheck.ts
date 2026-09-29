import { randomUUID } from 'node:crypto';

import { StorageDriver } from '@/domain/enums/StorageDriver';
import { getAppConfig } from '@/server/config/AppConfig';
import { createS3ObjectStorage } from '@/server/storage/S3ObjectStorage';
import { findS3SettingsProblems } from '@/server/storage/S3Settings';

const PROBE_CONTENT_TYPE = 'text/plain';

/** `pnpm storage:check`: put → get → exists → delete one probe object with the configured S3 keys. */
const runStorageCheck = async (): Promise<void> => {
  const config = getAppConfig();

  if (config.storageDriver !== StorageDriver.S3) {
    console.info(
      `[storage:check] STORAGE_DRIVER=${config.storageDriver}: S3 검사를 건너뜁니다 (STORAGE_DRIVER=s3 필요).`,
    );

    return;
  }

  const settings = {
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  };
  const problems = findS3SettingsProblems(settings);

  console.info('[storage:check] 대상', {
    endpoint: config.s3Endpoint ? new URL(config.s3Endpoint).host : '(AWS 기본)',
    region: config.s3Region,
    bucket: config.s3Bucket,
  });

  if (problems.length > 0 || !settings.bucket || !settings.accessKeyId || !settings.secretAccessKey) {
    throw new Error(`설정 문제: ${problems.join(' ')}`);
  }

  const storage = createS3ObjectStorage({
    ...settings,
    bucket: settings.bucket,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
  });
  const key = `healthchecks/probe-${randomUUID()}`;
  const body = Buffer.from(`offnal storage probe ${new Date().toISOString()}`);

  await storage.put(key, body, PROBE_CONTENT_TYPE);

  try {
    const read = await storage.get(key);

    if (!read || !read.equals(body)) {
      throw new Error('올린 객체를 같은 내용으로 다시 읽지 못했어요.');
    }

    if (!(await storage.exists(key))) {
      throw new Error('올린 객체가 exists 조회에서 보이지 않아요.');
    }
  } finally {
    await storage.delete(key);
  }

  if (await storage.exists(key)) {
    throw new Error('검사 객체를 삭제하지 못했어요.');
  }

  console.info('[storage:check] 성공: put·get·exists·delete 모두 통과');
};

runStorageCheck().catch((error: unknown) => {
  console.error('[storage:check] 실패', {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

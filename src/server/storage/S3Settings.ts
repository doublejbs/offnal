const SUPABASE_STORAGE_HOST_SUFFIX = '.storage.supabase.co';
const SUPABASE_S3_PATH = '/storage/v1/s3';

export type S3SettingsInput = {
  endpoint: string | null;
  region: string;
  bucket: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
};

/**
 * Problems with S3 settings, as Korean messages without secret values. Supabase Storage expects
 * `https://<ref>.storage.supabase.co/storage/v1/s3`, the project region and path-style addressing
 * (always on in S3ObjectStorage).
 */
export const findS3SettingsProblems = (settings: S3SettingsInput): string[] => {
  const problems: string[] = [];

  if (!settings.bucket) {
    problems.push('S3_BUCKET이 비어 있어요.');
  }

  if (!settings.accessKeyId || !settings.secretAccessKey) {
    problems.push('S3_ACCESS_KEY_ID·S3_SECRET_ACCESS_KEY가 필요해요.');
  }

  if (!settings.endpoint) {
    return problems;
  }

  const url = new URL(settings.endpoint);

  if (
    url.hostname.endsWith(SUPABASE_STORAGE_HOST_SUFFIX) &&
    url.pathname.replace(/\/$/, '') !== SUPABASE_S3_PATH
  ) {
    problems.push(
      `Supabase S3 엔드포인트는 https://<ref>${SUPABASE_STORAGE_HOST_SUFFIX}${SUPABASE_S3_PATH} 형식이어야 해요.`,
    );
  }

  if (url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith(SUPABASE_STORAGE_HOST_SUFFIX)) {
    problems.push(
      `Supabase S3 엔드포인트 호스트는 <ref>${SUPABASE_STORAGE_HOST_SUFFIX} 이에요 (API URL과 달라요).`,
    );
  }

  return problems;
};

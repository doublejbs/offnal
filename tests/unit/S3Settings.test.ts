import { describe, expect, it } from 'vitest';

import { findS3SettingsProblems, type S3SettingsInput } from '@/server/storage/S3Settings';

const SUPABASE_SETTINGS: S3SettingsInput = {
  endpoint: 'https://project-ref.storage.supabase.co/storage/v1/s3',
  region: 'ap-northeast-2',
  bucket: 'offnal-sources',
  accessKeyId: 'key-id',
  secretAccessKey: 'secret-value',
};

describe('findS3SettingsProblems', () => {
  it('accepts the Supabase Storage S3 endpoint', () => {
    expect(findS3SettingsProblems(SUPABASE_SETTINGS)).toEqual([]);
    expect(
      findS3SettingsProblems({ ...SUPABASE_SETTINGS, endpoint: `${SUPABASE_SETTINGS.endpoint}/` }),
    ).toEqual([]);
  });

  it('flags a wrong Supabase endpoint path or the API host', () => {
    expect(
      findS3SettingsProblems({ ...SUPABASE_SETTINGS, endpoint: 'https://project-ref.storage.supabase.co' }),
    ).toHaveLength(1);
    expect(
      findS3SettingsProblems({
        ...SUPABASE_SETTINGS,
        endpoint: 'https://project-ref.supabase.co/storage/v1/s3',
      }),
    ).toHaveLength(1);
  });

  it('flags missing bucket and keys without echoing secrets', () => {
    const problems = findS3SettingsProblems({ ...SUPABASE_SETTINGS, bucket: null, accessKeyId: null });

    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).not.toContain('secret-value');
  });
});

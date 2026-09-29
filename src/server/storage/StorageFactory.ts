import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { StorageDriver } from '@/domain/enums/StorageDriver';
import { getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/http/ApiError';
import { createLocalObjectStorage } from '@/server/storage/LocalObjectStorage';
import { type ObjectStorage } from '@/server/storage/ObjectStorage';
import { createS3ObjectStorage } from '@/server/storage/S3ObjectStorage';

type StorageGlobal = typeof globalThis & {
  __offnalObjectStorage?: ObjectStorage;
  __offnalObjectStorageOverride?: ObjectStorage | null;
};

const storageGlobal = globalThis as StorageGlobal;

const createObjectStorageFromConfig = (): ObjectStorage => {
  const config = getAppConfig();

  if (config.storageDriver === StorageDriver.LOCAL) {
    return createLocalObjectStorage(config.localStorageDir);
  }

  if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
    throw new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED, {
      message: '사진 저장소가 아직 설정되지 않았어요.',
    });
  }

  return createS3ObjectStorage({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  });
};

export const getObjectStorage = (): ObjectStorage => {
  if (storageGlobal.__offnalObjectStorageOverride) {
    return storageGlobal.__offnalObjectStorageOverride;
  }

  if (!storageGlobal.__offnalObjectStorage) {
    storageGlobal.__offnalObjectStorage = createObjectStorageFromConfig();
  }

  return storageGlobal.__offnalObjectStorage;
};

/** Overrides the storage returned by `getObjectStorage` (null clears). Tests only. */
export const setObjectStorageForTesting = (storage: ObjectStorage | null): void => {
  storageGlobal.__offnalObjectStorageOverride = storage;
};

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { StorageDriver } from '@/domain/enums/StorageDriver';
import { type AppConfig, getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/errors/ApiError';
import { createLocalObjectStorage } from '@/server/storage/LocalObjectStorage';
import { type ObjectStorage } from '@/server/storage/ObjectStorage';
import { createS3ObjectStorage } from '@/server/storage/S3ObjectStorage';

type StorageGlobal = typeof globalThis & {
  /** Cached per AppConfig instance, so `resetAppConfigForTesting` also resets the storage. */
  __offnalObjectStorage?: { config: AppConfig; storage: ObjectStorage };
  __offnalObjectStorageOverride?: ObjectStorage | null;
};

const storageGlobal = globalThis as StorageGlobal;

const createObjectStorageFromConfig = (config: AppConfig): ObjectStorage => {
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

  const config = getAppConfig();
  const cached = storageGlobal.__offnalObjectStorage;

  if (cached?.config === config) {
    return cached.storage;
  }

  const storage = createObjectStorageFromConfig(config);

  storageGlobal.__offnalObjectStorage = { config, storage };

  return storage;
};

/** Overrides the storage returned by `getObjectStorage` (null clears). Tests only. */
export const setObjectStorageForTesting = (storage: ObjectStorage | null): void => {
  storageGlobal.__offnalObjectStorageOverride = storage;
};

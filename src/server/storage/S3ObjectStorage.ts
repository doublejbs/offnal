import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import { assertValidObjectKey, type ObjectStorage } from '@/server/storage/ObjectStorage';

export type S3StorageConfig = {
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const NOT_FOUND_NAMES = new Set(['NoSuchKey', 'NotFound']);

const isNotFound = (error: unknown): boolean =>
  error instanceof S3ServiceException &&
  (NOT_FOUND_NAMES.has(error.name) || error.$metadata.httpStatusCode === 404);

/** S3-compatible private bucket (Supabase Storage S3 endpoint needs path-style addressing). */
export const createS3ObjectStorage = (config: S3StorageConfig): ObjectStorage => {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  return {
    put: async (key, bytes, contentType) => {
      assertValidObjectKey(key);
      await client.send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
    },
    get: async (key) => {
      assertValidObjectKey(key);

      try {
        const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));

        if (!result.Body) {
          return null;
        }

        return Buffer.from(await result.Body.transformToByteArray());
      } catch (error: unknown) {
        if (isNotFound(error)) {
          return null;
        }

        throw error;
      }
    },
    delete: async (key) => {
      assertValidObjectKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    exists: async (key) => {
      assertValidObjectKey(key);

      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));

        return true;
      } catch (error: unknown) {
        if (isNotFound(error)) {
          return false;
        }

        throw error;
      }
    },
  };
};

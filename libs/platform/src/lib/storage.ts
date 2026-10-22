import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { PlatformEnv } from './env.js';

/** Thin S3 wrapper (SeaweedFS locally, S3/R2/GCS-interop in production). */
export function createStorage(env: PlatformEnv) {
  const base = {
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  };
  const s3 = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
  // Presigned URLs must be signed for the host the browser will call.
  const publicS3 = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
  const Bucket = env.S3_BUCKET;

  return {
    bucket: Bucket,
    async ensureBucket() {
      try {
        await s3.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket }));
      }
      await s3
        .send(
          new PutBucketCorsCommand({
            Bucket,
            CORSConfiguration: {
              CORSRules: [{ AllowedMethods: ['PUT', 'GET'], AllowedOrigins: ['*'], AllowedHeaders: ['*'], MaxAgeSeconds: 3600 }],
            },
          }),
        )
        .catch(() => undefined); // not all S3-compatible stores support bucket CORS
    },
    async ping() {
      try {
        await s3.send(new HeadBucketCommand({ Bucket }));
        return true;
      } catch {
        return false;
      }
    },
    presignPut(key: string, contentType: string, expiresIn = 3600) {
      return getSignedUrl(publicS3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), { expiresIn });
    },
    async putJsonGz(key: string, value: unknown) {
      await s3.send(
        new PutObjectCommand({ Bucket, Key: key, Body: gzipSync(JSON.stringify(value)), ContentType: 'application/json', ContentEncoding: 'gzip' }),
      );
    },
    async getJsonGz<T>(key: string): Promise<T> {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      const buf = Buffer.from(bytes);
      // Some stores transparently decompress on GET; detect the gzip magic number.
      const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
      return JSON.parse(raw.toString('utf8')) as T;
    },
  };
}
export type Storage = ReturnType<typeof createStorage>;

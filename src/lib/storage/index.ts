/**
 * File storage behind one interface. Local disk for dev, S3-compatible (R2) for prod.
 * Keys look like "requests/<id>/versions/<vid>/full.mp3".
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";

/**
 * Storage is private. Nothing here produces a public URL: media reaches the
 * browser only through short-lived signed tokens (see src/lib/media/tokens.ts),
 * and full songs only after a verified purchase.
 */
export interface Storage {
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Local path for serving or processing, downloading first if remote. */
  localPath(key: string): Promise<string>;
  /** Delete the file (and any local cached copy). Deleting a missing file is not an error. */
  delete(key: string): Promise<void>;
}

function localRoot(): string {
  return env.storageLocalDir || path.join(process.cwd(), "storage");
}

const localStorage: Storage = {
  async putFile(key, filePath) {
    const dest = path.join(localRoot(), key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(filePath) !== path.resolve(dest)) fs.copyFileSync(filePath, dest);
  },
  async exists(key) {
    return fs.existsSync(path.join(localRoot(), key));
  },
  async localPath(key) {
    return path.join(localRoot(), key);
  },
  async delete(key) {
    if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${key}`);
    fs.rmSync(path.join(localRoot(), key), { force: true });
  },
};

async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: env.s3.region,
    endpoint: env.s3.endpoint || undefined,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
    // Only send checksums when an operation needs them; R2 and other S3-compatible stores
    // don't all accept the newer default ones.
    // Path-style URLs work on R2, MinIO and S3 alike.
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

async function s3Storage(): Promise<Storage> {
  const { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  return {
    async putFile(key, filePath, contentType) {
      await client.send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: fs.createReadStream(filePath), ContentLength: fs.statSync(filePath).size, ContentType: contentType }));
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async localPath(key) {
      const dest = path.join(localRoot(), "cache", key);
      if (fs.existsSync(dest)) return dest;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const res = await client.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      fs.writeFileSync(dest, Buffer.from(bytes));
      return dest;
    },
    async delete(key) {
      if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${key}`);
      await client.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
      fs.rmSync(path.join(localRoot(), "cache", key), { force: true });
    },
  };
}

/** Write, read back and delete a tiny object. Proves the bucket, endpoint and keys work. */
export async function checkBucket(): Promise<{ ok: boolean; message: string }> {
  if (env.storageDriver !== "s3") return { ok: true, message: `Local disk (${localRoot()}).` };
  const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  const Key = `_checks/startup-${Date.now()}.txt`;
  try {
    await client.send(new PutObjectCommand({ Bucket: env.s3.bucket, Key, Body: "ok", ContentType: "text/plain" }));
    const got = await (await client.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key }))).Body!.transformToString();
    await client.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key }));
    return got === "ok" ? { ok: true, message: `Bucket "${env.s3.bucket}": write, read and delete work.` } : { ok: false, message: `Bucket "${env.s3.bucket}" returned the wrong content.` };
  } catch (e) {
    return { ok: false, message: `Bucket "${env.s3.bucket}" check failed: ${(e as Error).name}: ${(e as Error).message}` };
  }
}

let instance: Promise<Storage> | null = null;
export function getStorage(): Promise<Storage> {
  if (!instance) instance = env.storageDriver === "s3" ? s3Storage() : Promise.resolve(localStorage);
  return instance;
}

export function resetStorageForTests(): void {
  instance = null;
}

export function isSafeKey(key: string): boolean {
  return !key.includes("..") && !path.isAbsolute(key) && /^[\w\-./]+$/.test(key);
}

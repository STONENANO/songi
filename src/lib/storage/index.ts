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
};

async function s3Storage(): Promise<Storage> {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: env.s3.region,
    endpoint: env.s3.endpoint || undefined,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
  });
  return {
    async putFile(key, filePath, contentType) {
      await client.send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: fs.createReadStream(filePath), ContentType: contentType }));
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
  };
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

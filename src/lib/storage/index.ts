/**
 * Audio storage behind one interface: local disk (default) or S3-compatible
 * object storage (Cloudflare R2, AWS S3). Keys are relative paths like
 * `requests/<id>/versions/<vid>/preview.mp3`.
 *
 * - local: files live under ./storage and are served by /api/audio/<key>.
 * - s3: files are uploaded to the bucket. With S3_PUBLIC_BASE_URL set, URLs
 *   point straight at the bucket; otherwise they go through /api/audio, which
 *   downloads the object to a local cache first.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../env";

export interface Storage {
  /** Copy a local file into storage under `key`. */
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  /** URL the browser can fetch. */
  publicUrl(key: string): string;
  /** A local filesystem path holding the object (downloads it first when remote). */
  localPath(key: string): Promise<string>;
}

/** Keys are relative, slash-separated, with no traversal or odd characters. */
export function isSafeKey(key: string): boolean {
  if (!key || key.length > 512 || key.startsWith("/") || key.includes("\\")) return false;
  return key.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && /^[A-Za-z0-9._-]+$/.test(part));
}

function assertKey(key: string) {
  if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${key}`);
}

const viaApi = (key: string) => `/api/audio/${key}`;

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private resolve(key: string): string {
    assertKey(key);
    return path.join(this.root, ...key.split("/"));
  }

  async putFile(key: string, filePath: string): Promise<void> {
    const dest = this.resolve(key);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(filePath, dest);
  }

  publicUrl(key: string): string {
    return viaApi(key);
  }

  async localPath(key: string): Promise<string> {
    const p = this.resolve(key);
    await fs.promises.access(p);
    return p;
  }
}

class S3Storage implements Storage {
  private cacheDir = path.join(os.tmpdir(), "song-audio-cache");
  // Lazily created so the AWS SDK only loads when this driver is used.
  private clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;

  private client() {
    if (!this.clientPromise) {
      this.clientPromise = import("@aws-sdk/client-s3").then(
        ({ S3Client }) =>
          new S3Client({
            region: env.s3.region,
            endpoint: env.s3.endpoint || undefined,
            forcePathStyle: !!env.s3.endpoint,
            credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
          }),
      );
    }
    return this.clientPromise;
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<void> {
    assertKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const body = await fs.promises.readFile(filePath);
    await (await this.client()).send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  publicUrl(key: string): string {
    return env.s3.publicBaseUrl ? `${env.s3.publicBaseUrl}/${key}` : viaApi(key);
  }

  async localPath(key: string): Promise<string> {
    assertKey(key);
    const dest = path.join(this.cacheDir, ...key.split("/"));
    if (fs.existsSync(dest)) return dest;
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await this.client()).send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    const bytes = await res.Body.transformToByteArray();
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.part`;
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, dest);
    return dest;
  }
}

const globalForStorage = globalThis as unknown as { __songStorage?: Storage };

export async function getStorage(): Promise<Storage> {
  if (!globalForStorage.__songStorage) {
    if (env.storageDriver === "s3") {
      if (!env.s3.bucket) throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET (and credentials).");
      globalForStorage.__songStorage = new S3Storage();
    } else {
      globalForStorage.__songStorage = new LocalStorage(path.join(process.cwd(), "storage"));
    }
  }
  return globalForStorage.__songStorage;
}

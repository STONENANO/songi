/**
 * Save a track's cover art into our own storage. The provider's image links are
 * temporary, and the song page is kept and shared for years. Best effort: a song
 * without a saved cover just shows the default artwork.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env";
import { getStorage } from "../storage";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 8 * 1024 * 1024;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[::1\]|\[f[cd]|::1$)/i;

export const coverContentType = (key: string) => Object.entries(TYPES).find(([, ext]) => key.endsWith(`.${ext}`))?.[0] ?? "image/jpeg";

/** Returns the storage key, or null when there is no usable image. Never throws. */
export async function saveCover(imageUrl: string | null | undefined, baseKey: string, tmpDir: string): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const u = new URL(imageUrl);
    let bytes: Buffer;
    let type: string;
    if (u.protocol === "file:") {
      if (!env.mockKie) return null;
      bytes = fs.readFileSync(fileURLToPath(u));
      type = imageUrl.endsWith(".png") ? "image/png" : "image/jpeg";
    } else {
      // Public https only: no credentials, private addresses or raw IPs.
      if (u.protocol !== "https:" || u.username || u.password || PRIVATE_HOST.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
      const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
      type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!res.ok || !TYPES[type]) return null;
      if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    if (!bytes.length || bytes.length > MAX_BYTES || !TYPES[type]) return null;
    const key = `${baseKey}/cover.${TYPES[type]}`;
    const file = path.join(tmpDir, `cover.${TYPES[type]}`);
    fs.writeFileSync(file, bytes);
    await (await getStorage()).putFile(key, file, type);
    return key;
  } catch {
    return null;
  }
}

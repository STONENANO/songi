import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { verifyMediaToken } from "@/lib/media/tokens";
import { getStorage, isSafeKey } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Serves private audio behind signed, expiring tokens, with HTTP Range support.
 * Full-song tokens are re-checked against the database: a refund revokes access
 * even if a link is still unexpired.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const claims = verifyMediaToken(decodeURIComponent(token));
  if (!claims || !isSafeKey(claims.k)) return new Response("Link expired or invalid", { status: 403 });

  if (claims.t === "full") {
    const db = await getDb();
    const [v] = claims.v ? await db.select().from(schema.songVersions).where(and(eq(schema.songVersions.id, claims.v), eq(schema.songVersions.audioKey, claims.k))).limit(1) : [];
    if (!v || v.purchaseStatus !== "paid") return new Response("Not available", { status: 403 });
  }

  const storage = await getStorage();
  const file = await storage.localPath(claims.k).catch(() => null);
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });

  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  // A filename in the token means "download"; without one the full song streams inline (the player page).
  if (claims.t === "full" && claims.n) headers["Content-Disposition"] = `attachment; filename="${claims.n.replace(/"/g, "")}"`;
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    return new Response(fs.createReadStream(file, { start, end }) as unknown as ReadableStream, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new Response(fs.createReadStream(file) as unknown as ReadableStream, { status: 200, headers });
}

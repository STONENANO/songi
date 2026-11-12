import fs from "node:fs";
import { Readable } from "node:stream";
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
    return new Response(webStream(file, { start, end }), { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new Response(webStream(file), { status: 200, headers });
}

/**
 * A proper web stream over the file. When the browser cancels (the player seeks, or the
 * listener leaves), the file stream is closed too, instead of writing into a closed response.
 */
function webStream(file: string, range?: { start: number; end: number }): ReadableStream {
  return Readable.toWeb(fs.createReadStream(file, range)) as unknown as ReadableStream;
}

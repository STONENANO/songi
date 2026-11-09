import fs from "node:fs";
import { getStorage, isSafeKey } from "@/lib/storage";

export const runtime = "nodejs";

/** Serves stored audio with HTTP Range support so browsers can seek. */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const key = parts.join("/");
  if (!isSafeKey(key)) return new Response("Bad key", { status: 400 });
  const storage = await getStorage();
  const file = await storage.localPath(key).catch(() => null);
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });

  const size = fs.statSync(file).size;
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    const stream = fs.createReadStream(file, { start, end });
    return new Response(stream as unknown as ReadableStream, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new Response(fs.createReadStream(file) as unknown as ReadableStream, { status: 200, headers });
}

import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { verifyDeliveryToken } from "@/lib/media/tokens";
import { getStorage, isSafeKey } from "@/lib/storage";
import { coverContentType } from "@/lib/media/cover";

export const runtime = "nodejs";

/**
 * Cover art for a bought song, by its permanent delivery token. As public as the
 * song page itself, so link previews and lock screens can show it; cacheable.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const orderId = verifyDeliveryToken(decodeURIComponent((await ctx.params).token));
  if (!orderId) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order || order.status !== "paid") return new Response("Not found", { status: 404 });
  const [v] = await db.select().from(schema.songVersions).where(eq(schema.songVersions.id, order.versionId)).limit(1);
  if (!v?.coverKey || !isSafeKey(v.coverKey)) return new Response("Not found", { status: 404 });
  const file = await (await getStorage()).localPath(v.coverKey).catch(() => null);
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { "Content-Type": coverContentType(v.coverKey), "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}

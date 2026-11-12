/** Shared loading and access checks for the checkout and post-purchase pages (server only). */
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { checkAccess } from "../session/project";
import { normalizeBrief } from "../songcraft";

export async function loadCheckout(orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) return null;
  const [r] = await db.select().from(schema.songRequests).where(eq(schema.songRequests.id, order.requestId)).limit(1);
  const [v] = await db.select().from(schema.songVersions).where(eq(schema.songVersions.id, order.versionId)).limit(1);
  if (!r || !v) return null;
  // Same owner check as the song page: the project cookie set when the song was started.
  const h = await headers();
  const access = checkAccess(new Request("http://checkout.local/", { headers: { cookie: h.get("cookie") ?? "" } }), r);
  const name = normalizeBrief(r.brief)?.recipient.name || r.recipientName || "your loved one";
  return { order, request: r, version: v, name, owner: access !== "denied" };
}

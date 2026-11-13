import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { verifyDeliveryToken } from "@/lib/media/tokens";
import { normalizeBrief } from "@/lib/songcraft";

/** Everything the song page needs, loaded once per request (page and metadata share it). */
export const loadSong = cache(async (token: string) => {
  const orderId = verifyDeliveryToken(decodeURIComponent(token));
  if (!orderId) return null;
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order || order.status !== "paid" || !order.fulfilledAt) return null;
  const [v] = await db.select().from(schema.songVersions).where(eq(schema.songVersions.id, order.versionId)).limit(1);
  const [r] = await db.select().from(schema.songRequests).where(eq(schema.songRequests.id, order.requestId)).limit(1);
  if (!v?.audioKey || !r) return null;
  const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, v.generationId)).limit(1);
  const [lyrics] = gen ? await db.select().from(schema.lyricDrafts).where(eq(schema.lyricDrafts.id, gen.lyricDraftId)).limit(1) : [];
  const brief = normalizeBrief(r.brief);
  const name = brief?.recipient.name || r.recipientName || "someone special";
  const quiz = (r.quizSnapshot ?? {}) as Record<string, unknown>;
  const giver = (typeof quiz.giverName === "string" && quiz.giverName) || brief?.giverName || "";
  const title = v.title || `${name}'s Song`;
  return { order, v, r, lyrics, brief, name, giver, title };
});


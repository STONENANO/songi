import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { getRequest } from "@/lib/pipeline/run";

export const runtime = "nodejs";

/**
 * Unlock the full song with a creator code (no checkout yet). Lets UGC
 * creators hear and film the whole song. Disabled when CREATOR_UNLOCK_CODE is empty.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  if (!env.creatorUnlockCode) return NextResponse.json({ error: "Unlocking is not available yet." }, { status: 403 });
  if ((body.code ?? "").trim() !== env.creatorUnlockCode) return NextResponse.json({ error: "That code didn't work." }, { status: 403 });
  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = await getDb();
  await db.update(schema.songRequests).set({ unlocked: true, updatedAt: new Date() }).where(eq(schema.songRequests.id, id));
  await db.insert(schema.events).values({ requestId: id, type: "unlock:creator_code", payload: {} });
  return NextResponse.json({ ok: true });
}

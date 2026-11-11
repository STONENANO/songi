import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireProject } from "@/lib/http/guard";
import { logEvent } from "@/lib/pipeline/common";

export const runtime = "nodejs";

const Body = z.object({
  rating: z.number().int().min(1).max(5),
  wouldPay: z.enum(["yes", "maybe", "no"]).nullable().optional(),
  note: z.string().max(2000).optional(),
  versionId: z.string().uuid().nullable().optional(),
});

/** Tester feedback on a finished song. One row per submission; the latest one counts. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a rating from 1 to 5." }, { status: 400 });
  const db = await getDb();
  let versionId = parsed.data.versionId ?? null;
  if (versionId) {
    const [v] = await db.select({ id: schema.songVersions.id }).from(schema.songVersions).where(and(eq(schema.songVersions.id, versionId), eq(schema.songVersions.requestId, id))).limit(1);
    if (!v) versionId = null;
  }
  await db.insert(schema.feedback).values({ requestId: id, versionId, rating: parsed.data.rating, wouldPay: parsed.data.wouldPay ?? null, note: parsed.data.note?.trim() || null });
  await logEvent(id, "feedback", { rating: parsed.data.rating, wouldPay: parsed.data.wouldPay ?? null });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { startGeneration } from "@/lib/pipeline/run";

export const runtime = "nodejs";

const Body = z.object({ draftId: z.string().uuid().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
  const result = await startGeneration(id, parsed.success ? parsed.data.draftId : undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}

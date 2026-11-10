import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { startGeneration } from "@/lib/pipeline/run";
import { requireProject } from "@/lib/http/guard";

export const runtime = "nodejs";

const Body = z.object({ draftId: z.string().uuid().optional(), more: z.boolean().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
  const body = parsed.success ? parsed.data : {};
  const result = await startGeneration(id, { draftId: body.draftId, trigger: body.more ? "extra" : undefined });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { startGeneration } from "@/lib/pipeline/run";
import { requireProject } from "@/lib/http/guard";
import { checkAction, ALREADY_ON_IT } from "@/lib/pipeline/states";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

const Body = z.object({ draftId: z.string().uuid().optional(), more: z.boolean().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const raw = await readJson(req, BODY_LIMITS.small);
  if (!raw.ok) return raw.response;
  const parsed = Body.safeParse(raw.data ?? {});
  const body = parsed.success ? parsed.data : {};
  const check = checkAction("record", g.r.status);
  if (!check.ok) return check.already ? NextResponse.json({ ok: true, already: true, message: ALREADY_ON_IT }) : NextResponse.json({ error: check.message }, { status: 409 });
  const result = await startGeneration(id, { draftId: body.draftId, trigger: body.more ? "extra" : undefined });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}

import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { runBriefing, submitFollowUpAnswers } from "@/lib/pipeline/run";
import { checkAction, ALREADY_ON_IT } from "@/lib/pipeline/states";
import { requireProject } from "@/lib/http/guard";

export const runtime = "nodejs";

const Body = z.object({ answers: z.record(z.string().max(300), z.string().trim().max(1000)) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please check your answers and try again." }, { status: 400 });
  const check = checkAction("answer", g.r.status);
  if (!check.ok) return check.already ? NextResponse.json({ ok: true, already: true, message: ALREADY_ON_IT }) : NextResponse.json({ error: check.message }, { status: 409 });
  // Saves the answers and moves to "briefing" before replying; the writing runs after.
  const outcome = await submitFollowUpAnswers(id, parsed.data.answers);
  if (outcome === "started") after(() => runBriefing(id));
  if (outcome === "not_waiting") return NextResponse.json({ error: "We're already working on your song. This page updates on its own." }, { status: 409 });
  return NextResponse.json({ ok: true, already: outcome === "already" });
}

import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { getRequest, submitFollowUpAnswers } from "@/lib/pipeline/run";

export const runtime = "nodejs";

const Body = z.object({ answers: z.record(z.string().max(300), z.string().trim().max(1000)) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r.status !== "needs_input") return NextResponse.json({ error: `Not waiting for answers (status ${r.status})` }, { status: 409 });
  after(() => submitFollowUpAnswers(id, parsed.data.answers));
  return NextResponse.json({ ok: true });
}

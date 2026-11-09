import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { getRequest, runLyrics, submitEditedLyrics } from "@/lib/pipeline/run";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("regenerate") }),
  z.object({ action: z.literal("edit"), text: z.string().min(20).max(6000) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r.status !== "lyrics_ready") return NextResponse.json({ error: `Lyrics are not editable while status is ${r.status}` }, { status: 409 });

  if (parsed.data.action === "regenerate") {
    after(() => runLyrics(id, { source: "regenerated" }));
    return NextResponse.json({ ok: true });
  }
  const result = await submitEditedLyrics(id, parsed.data.text);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

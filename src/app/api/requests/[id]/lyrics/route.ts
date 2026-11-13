import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { runLyrics, submitEditedLyrics, maybeAutoRecord } from "@/lib/pipeline/run";
import { requireProject } from "@/lib/http/guard";
import { claimStatus } from "@/lib/pipeline/common";
import { checkAction, ALREADY_ON_IT } from "@/lib/pipeline/states";
import { rateLimit } from "@/lib/http/rate-limit";
import { lyricRewriteAllowance, recordRewrite } from "@/lib/pipeline/spend";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("regenerate") }),
  z.object({ action: z.literal("edit"), text: z.string().min(20).max(6000) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const body = await readJson(req, BODY_LIMITS.lyrics);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Please check your lyrics and try again." }, { status: 400 });
  // A song that failed while writing lyrics can ask for new ones ("Try again" on the song page).
  const retryAfterFailure = parsed.data.action === "regenerate" && g.r.status === "failed" && !!g.r.brief;
  if (g.r.status === "failed" && !retryAfterFailure) return NextResponse.json({ error: "Something went wrong with this song. Please start a new one." }, { status: 409 });
  const check = checkAction("rewrite", g.r.status);
  if (!check.ok) return check.already ? NextResponse.json({ ok: true, already: true, message: ALREADY_ON_IT }) : NextResponse.json({ error: check.message }, { status: 409 });
  if (!(await rateLimit(`lyrics:${id}`, 8, 60 * 60_000))) return NextResponse.json({ error: "You've asked for a lot of new lyrics. Please try again later." }, { status: 429 });
  // Lasting per-song limit on Claude spend (count of rewrites and estimated dollars).
  const allowance = await lyricRewriteAllowance(id);
  if (!allowance.ok) return NextResponse.json({ error: allowance.error }, { status: 429 });

  if (parsed.data.action === "regenerate") {
    // Record "writing" before replying, so the page moves on at once and a second click is a no-op.
    if (!(await claimStatus(id, [g.r.status], "writing_lyrics"))) return NextResponse.json({ ok: true, already: true, message: ALREADY_ON_IT });
    await recordRewrite(id, "regenerate");
    after(async () => {
      await runLyrics(id, { source: "regenerated" });
      // Story-quiz songs that never got to record go straight on to recording, as they would have.
      if (retryAfterFailure) await maybeAutoRecord(id);
    });
    return NextResponse.json({ ok: true });
  }
  await recordRewrite(id, "edit");
  const result = await submitEditedLyrics(id, parsed.data.text);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}

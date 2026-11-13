import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { logEvent } from "@/lib/pipeline/common";
import { requireProject } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

const Body = z.object({ type: z.enum(["preview_play", "preview_complete"]), versionId: z.string().uuid(), position: z.number().int().min(0).max(10).optional() });

/** Listening analytics for conversion metrics. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const body = await readJson(req, BODY_LIMITS.small);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "bad event" }, { status: 400 });
  if (!(await rateLimit(`events:${id}`, 200, 60 * 60_000))) return NextResponse.json({ ok: true });
  await logEvent(id, parsed.data.type, { versionId: parsed.data.versionId, position: parsed.data.position });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { selectVersion } from "@/lib/pipeline/run";
import { requireProject } from "@/lib/http/guard";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

const Body = z.object({ versionId: z.string().uuid() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const body = await readJson(req, BODY_LIMITS.small);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  const result = await selectVersion(id, parsed.data.versionId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}

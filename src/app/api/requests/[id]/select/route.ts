import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { selectVersion } from "@/lib/pipeline/run";
import { requireProject } from "@/lib/http/guard";

export const runtime = "nodejs";

const Body = z.object({ versionId: z.string().uuid() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  const result = await selectVersion(id, parsed.data.versionId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}

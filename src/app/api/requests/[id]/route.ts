import { NextResponse, after } from "next/server";
import { getRequestView, pollIfGenerating } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const view = await getRequestView(id);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // If the provider callback has not arrived, check on the task in the background.
  if (view.status === "generating") after(() => pollIfGenerating(id));
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}

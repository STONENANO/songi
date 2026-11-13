import { NextResponse, after } from "next/server";
import { getRequestView, pollIfGenerating } from "@/lib/pipeline/run";
import { requireProject } from "@/lib/http/guard";
import { projectCookie } from "@/lib/session/project";
import { previewLinkCookie, verifyPreviewLink } from "@/lib/session/preview-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id);
  if (g instanceof NextResponse) return g;
  const view = await getRequestView(id, g.access);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Fallback for missed callbacks: check on in-flight tasks in the background.
  if (view.status === "generating" || view.status === "processing") after(() => pollIfGenerating(id));
  const res = NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  // A ?k= claim link (e.g. from an email) sets the cookie on this device.
  const params = new URL(req.url).searchParams;
  const k = params.get("k");
  if (k && g.access === "owner") res.headers.append("Set-Cookie", projectCookie(id, k));
  // A direct preview link (?p=) keeps working on this device, until it expires, after the URL changes.
  const p = params.get("p");
  if (p && g.access === "link") {
    const check = verifyPreviewLink(p, id);
    if (check.status === "valid") res.headers.append("Set-Cookie", previewLinkCookie(id, p, check.expiresAtMs));
  }
  return res;
}

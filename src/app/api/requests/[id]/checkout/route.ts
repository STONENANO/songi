import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { startCheckout } from "@/lib/commerce/orders";
import { requireProject } from "@/lib/http/guard";

export const runtime = "nodejs";

const Body = z.object({ versionId: z.string().uuid() });

/** Only a version id comes from the client. Price comes from Shopify; ownership is checked server-side. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireProject(req, id, { allowLegacy: false });
  if (g instanceof NextResponse) return g;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a version first." }, { status: 400 });
  if (!["preview_ready", "purchased"].includes(g.r.status)) return NextResponse.json({ error: "Your versions aren't ready yet." }, { status: 409 });
  const result = await startCheckout(id, parsed.data.versionId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ checkoutUrl: result.checkoutUrl });
}

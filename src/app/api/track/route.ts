import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";

export const runtime = "nodejs";

const Body = z.object({
  type: z.string().regex(/^[a-z_]+:[a-z0-9_]+$/).max(60),
  sessionId: z.string().max(64),
  requestId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional().default({}),
});

/** Funnel analytics: quiz step views, skips, follow-up answers. Fire and forget from the client. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 204 });
  const { type, sessionId, requestId, payload } = parsed.data;
  try {
    const db = await getDb();
    await db.insert(schema.events).values({ requestId: requestId ?? null, type, payload: { ...payload, sessionId } });
  } catch (e) {
    console.warn("[track] dropped event", type, e instanceof Error ? e.message : e);
  }
  return new NextResponse(null, { status: 204 });
}

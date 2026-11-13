import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

const MAX_PAYLOAD_KEYS = 20;

const Body = z.object({
  type: z.string().regex(/^[a-z_]+:[a-z0-9_]+$/).max(60),
  sessionId: z.string().max(64),
  requestId: z.string().uuid().optional(),
  // A bounded number of short keys: each event becomes one database row.
  payload: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((p) => Object.keys(p).length <= MAX_PAYLOAD_KEYS, `At most ${MAX_PAYLOAD_KEYS} payload fields.`)
    .optional()
    .default({}),
});

/** Funnel analytics: quiz step views, skips, follow-up answers. Fire and forget from the client. */
export async function POST(req: Request) {
  const body = await readJson(req, BODY_LIMITS.track);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.data);
  if (!parsed.success || !(await rateLimit(`track:${clientIp(req)}`, 300, 60 * 60_000))) return new NextResponse(null, { status: 204 });
  const { type, sessionId, requestId, payload } = parsed.data;
  try {
    const db = await getDb();
    await db.insert(schema.events).values({ requestId: requestId ?? null, type, payload: { ...payload, sessionId } });
  } catch (e) {
    console.warn("[track] dropped event", type, e instanceof Error ? e.message : e);
  }
  return new NextResponse(null, { status: 204 });
}

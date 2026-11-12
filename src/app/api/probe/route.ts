import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { probeAnswer, mockProbe } from "@/lib/songcraft/probe";
import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/session/project";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

const Body = z.object({
  recipientName: z.string().max(60).default(""),
  relationship: z.string().max(40).default(""),
  pronoun: z.enum(["she", "he", "they"]).default("they"),
  question: z.string().max(300),
  answer: z.string().min(1).max(2000),
  isFollowUp: z.boolean().default(false),
  fallbackDig: z.string().max(300).default(""),
});

/** Never fails the quiz: on any model error, fall back to the rule-based probe. */
export async function POST(req: Request) {
  const body = await readJson(req, BODY_LIMITS.small);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ reaction: "", followUp: "", ingredients: [] });
  // Each call costs a model request: past the per-connection limit, use the free rule-based version.
  if (!rateLimit(`probe:${clientIp(req)}`, env.isProd ? 40 : 1000, 60 * 60_000)) return NextResponse.json(mockProbe(parsed.data));
  try {
    return NextResponse.json(await probeAnswer(parsed.data));
  } catch (e) {
    console.warn("[probe] falling back:", e instanceof Error ? e.message : e);
    return NextResponse.json(mockProbe(parsed.data));
  }
}

import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { GENRES } from "@/lib/songcraft";
import { runBriefing } from "@/lib/pipeline/run";

export const runtime = "nodejs";

const Body = z.object({
  recipientName: z.string().trim().max(60).optional().default(""),
  pronunciation: z.string().trim().max(60).optional().default(""),
  relationship: z.string().trim().min(1).max(40),
  occasion: z.string().trim().min(1).max(40),
  story: z.string().trim().min(10, "Tell us a little more.").max(4000),
  genreKey: z.string().refine((k) => k in GENRES, "Unknown genre"),
  vocalGender: z.enum(["m", "f", "any"]).default("any"),
  mood: z.string().trim().max(40).optional().default(""),
  customStyle: z.string().trim().max(300).optional().default(""),
  email: z.string().trim().email().optional().or(z.literal("")).default(""),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
  }
  const b = parsed.data;
  const db = await getDb();
  const [row] = await db
    .insert(schema.songRequests)
    .values({
      recipientName: b.recipientName || null,
      pronunciation: b.pronunciation || null,
      relationship: b.relationship,
      occasion: b.occasion,
      story: b.story,
      genreKey: b.genreKey,
      vocalGender: b.vocalGender,
      mood: b.mood || null,
      customStyle: b.customStyle || null,
      email: b.email || null,
    })
    .returning({ id: schema.songRequests.id });

  // Brief extraction + lyric writing take 10 to 40 seconds; run after responding.
  after(() => runBriefing(row.id));
  return NextResponse.json({ id: row.id }, { status: 201 });
}

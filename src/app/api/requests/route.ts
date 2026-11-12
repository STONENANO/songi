import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { GENRES } from "@/lib/songcraft";
import { runBriefing } from "@/lib/pipeline/run";
import { composeStory, StoryAnswerSchema } from "@/lib/onboarding/story";

export const runtime = "nodejs";

const Body = z.object({
  recipientName: z.string().trim().max(60).optional().default(""),
  pronunciation: z.string().trim().max(60).optional().default(""),
  relationship: z.string().trim().min(1).max(40),
  occasion: z.string().trim().min(1).max(40),
  neededBy: z.string().trim().max(20).optional().default(""),
  /** New quiz: structured answers. Old clients may still send a plain `story`. */
  answers: z.array(StoryAnswerSchema).max(6).optional().default([]),
  story: z.string().trim().max(4000).optional().default(""),
  oneLine: z.string().trim().max(300).optional().default(""),
  feeling: z.string().trim().max(40).optional().default(""),
  leaveOut: z.string().trim().max(300).optional().default(""),
  genreKey: z.string().refine((k) => k in GENRES, "Unknown genre"),
  vocalGender: z.enum(["m", "f", "any"]).default("any"),
  mood: z.string().trim().max(40).optional().default(""),
  customStyle: z.string().trim().max(300).optional().default(""),
  email: z.string().trim().email("Please enter a valid email.").optional().or(z.literal("")).default(""),
  phone: z.string().trim().max(30).optional().default(""),
  giverName: z.string().trim().max(60).optional().default(""),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
  }
  const b = parsed.data;
  const story = b.answers.length ? composeStory(b.answers, b.oneLine) : b.story;
  if (story.trim().length < 10) return NextResponse.json({ error: "Tell us a little more about them." }, { status: 400 });

  const db = await getDb();
  const [row] = await db
    .insert(schema.songRequests)
    .values({
      recipientName: b.recipientName || null,
      pronunciation: b.pronunciation || null,
      relationship: b.relationship,
      occasion: b.occasion,
      story,
      storyAnswers: b.answers.length ? (b.answers as unknown as Record<string, unknown>[]) : null,
      oneLine: b.oneLine || null,
      feeling: b.feeling || null,
      leaveOut: b.leaveOut || null,
      neededBy: b.neededBy || null,
      genreKey: b.genreKey,
      vocalGender: b.vocalGender,
      mood: b.mood || null,
      customStyle: b.customStyle || null,
      email: b.email || null,
      phone: b.phone || null,
      giverName: b.giverName || null,
      // The structured quiz records straight after lyrics; the legacy form waits for approval.
      autoGenerate: b.answers.length > 0,
    })
    .returning({ id: schema.songRequests.id });

  // Brief extraction + lyric writing take 10 to 40 seconds; run after responding.
  after(() => runBriefing(row.id));
  return NextResponse.json({ id: row.id }, { status: 201 });
}

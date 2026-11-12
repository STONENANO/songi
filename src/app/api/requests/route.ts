import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { and, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { GENRES } from "@/lib/songcraft";
import { runBriefing } from "@/lib/pipeline/run";
import { newProjectToken, projectCookie, rateLimit, clientIp } from "@/lib/session/project";
import { composeStory, StoryAnswerSchema } from "@/lib/onboarding/story";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

const Body = z.object({
  recipientName: z.string().trim().max(60).optional().default(""),
  pronunciation: z.string().trim().max(60).optional().default(""),
  relationship: z.string().trim().min(1).max(40),
  occasion: z.string().trim().min(1).max(40),
  /** Story quiz: structured answers. Older clients and scripts send a plain `story`. */
  answers: z.array(StoryAnswerSchema).max(8).optional().default([]),
  story: z.string().trim().max(4000).optional().default(""),
  oneLine: z.string().trim().max(300).optional().default(""),
  feeling: z.string().trim().max(40).optional().default(""),
  leaveOut: z.string().trim().max(300).optional().default(""),
  neededBy: z.string().trim().max(20).optional().default(""),
  giverName: z.string().trim().max(60).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  genreKey: z.string().refine((k) => k in GENRES, "Unknown genre"),
  vocalGender: z.enum(["m", "f", "any"]).default("any"),
  mood: z.string().trim().max(40).optional().default(""),
  customStyle: z.string().trim().max(300).optional().default(""),
  email: z.string().trim().email("Please enter a valid email.").optional().or(z.literal("")).default(""),
});

export async function POST(req: Request) {
  // Abuse control: song projects trigger paid generation later, so cap creation per IP.
  if (!rateLimit(`create:${clientIp(req)}`, env.isProd ? 8 : 200, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many songs started from this connection. Please try again later." }, { status: 429 });
  }
  const body = await readJson(req, BODY_LIMITS.create);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
  const b = parsed.data;
  const fromQuiz = b.answers.length > 0;
  const story = fromQuiz ? composeStory(b.answers, b.oneLine) : b.story;
  if (story.trim().length < 10) return NextResponse.json({ error: "Tell us a little more." }, { status: 400 });

  const db = await getDb();
  // Site-wide daily cap: every song costs real API money, and the test site is open to anyone.
  if (env.maxSongsPerDay > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.songRequests).where(and(gte(schema.songRequests.createdAt, since)));
    if (n >= env.maxSongsPerDay) {
      return NextResponse.json({ error: "We've reached today's limit for new songs while we're testing. Please try again tomorrow." }, { status: 429 });
    }
  }
  const { token, hash } = newProjectToken();
  const [row] = await db
    .insert(schema.songRequests)
    .values({
      recipientName: b.recipientName || null,
      pronunciation: b.pronunciation || null,
      relationship: b.relationship,
      occasion: b.occasion,
      story,
      genreKey: b.genreKey,
      vocalGender: b.vocalGender,
      mood: b.mood || null,
      customStyle: b.customStyle || null,
      email: b.email || null,
      accessTokenHash: hash,
      // The story quiz's extra answers (one line, feeling, leave-out, who it's from…) live here;
      // `autoRecord` makes the pipeline record as soon as verified lyrics exist.
      quizSnapshot: { ...b, story, autoRecord: fromQuiz, quizVersion: fromQuiz ? "story-v1" : "classic", submittedAt: new Date().toISOString() },
      // Experiment arm recorded with the project so results can be compared later.
      experiment: {
        writer: env.writerVersion,
        directionMode: process.env.DIRECTION_MODE === "legacy" ? "legacy" : "director",
        vocalMode: process.env.VOCAL_MODE === "generic" ? "generic" : "specific",
        variantMode: env.variantMode,
        desired: env.desiredCandidates,
        collection: env.candidateCollection,
        quiz: fromQuiz ? "story-v1" : "classic",
      },
    })
    .returning({ id: schema.songRequests.id });

  after(() => runBriefing(row.id));
  const res = NextResponse.json({ id: row.id }, { status: 201 });
  res.headers.append("Set-Cookie", projectCookie(row.id, token));
  return res;
}

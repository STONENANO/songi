import { NextResponse, after } from "next/server";
import { z } from "zod/v4";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { GENRES } from "@/lib/songcraft";
import { runBriefing } from "@/lib/pipeline/run";
import { newProjectToken, projectCookie } from "@/lib/session/project";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { verifyTurnstile } from "@/lib/http/turnstile";
import { normalizeEmail } from "@/lib/email";
import { reportIssue } from "@/lib/observability";
import { composeStory, StoryAnswerSchema } from "@/lib/onboarding/story";
import { readJson, BODY_LIMITS } from "@/lib/http/body";
import { logPostHogInfo } from "@/lib/posthog-logs";

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
  /** Cloudflare Turnstile token from the quiz (required when Turnstile is configured). */
  turnstileToken: z.string().max(2048).optional(),
});

export async function POST(req: Request) {
  // Abuse control: song projects trigger paid generation later, so cap creation per IP.
  const ip = clientIp(req);
  if (!(await rateLimit(`create:${ip}`, env.isProd ? 8 : 200, 60 * 60_000))) {
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
  // The weekly per-email limit needs an address. The quiz always asks for one; local scripts may skip it.
  if (env.isProd && !b.email) return NextResponse.json({ error: "Please enter your email." }, { status: 400 });
  const emailNormalized = b.email ? normalizeEmail(b.email) : null;

  const db = await getDb();
  // Free previews per email address per rolling week.
  if (emailNormalized && env.maxSongsPerEmailPerWeek > 0) {
    const week = 7 * 24 * 60 * 60_000;
    const recent = await db
      .select({ at: schema.songRequests.createdAt })
      .from(schema.songRequests)
      .where(and(eq(schema.songRequests.emailNormalized, emailNormalized), gte(schema.songRequests.createdAt, new Date(Date.now() - week))))
      .orderBy(asc(schema.songRequests.createdAt));
    if (recent.length >= env.maxSongsPerEmailPerWeek) {
      // When the oldest of them leaves the 7-day window. In days, not a date: the server doesn't know the buyer's time zone.
      const days = Math.max(1, Math.ceil((recent[0].at.getTime() + week - Date.now()) / (24 * 60 * 60_000)));
      return NextResponse.json(
        { error: `You've started ${env.maxSongsPerEmailPerWeek} songs with this email this week. You can start another in ${days} day${days === 1 ? "" : "s"}.`, code: "email_weekly_limit" },
        { status: 429 },
      );
    }
  }
  // A person pressed the button: checked before anything that costs money.
  const human = await verifyTurnstile(b.turnstileToken, ip);
  if (!human.ok) return NextResponse.json({ error: "We couldn't confirm you're not a robot. Please try again.", code: "turnstile" }, { status: 403 });

  // Optional site-wide cap (off by default: MAX_SONGS_PER_DAY=0). Volume is watched by songVolumeAlert below instead.
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const songsToday = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.songRequests).where(gte(schema.songRequests.createdAt, since)))[0].n;
  if (env.maxSongsPerDay > 0 && (await songsToday()) >= env.maxSongsPerDay) {
    return NextResponse.json({ error: "We've reached today's limit for new songs. Please try again tomorrow." }, { status: 429 });
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
      emailNormalized,
      accessTokenHash: hash,
      // The story quiz's extra answers (one line, feeling, leave-out, who it's from…) live here;
      // `autoRecord` makes the pipeline record as soon as verified lyrics exist.
      quizSnapshot: { ...b, turnstileToken: undefined, story, autoRecord: fromQuiz, quizVersion: fromQuiz ? "story-v1" : "classic", submittedAt: new Date().toISOString() },
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

  // With no daily cap, an unusual day should still reach a person: report each multiple of the threshold.
  if (env.songVolumeAlertPerDay > 0) {
    const n = await songsToday();
    if (n % env.songVolumeAlertPerDay === 0) reportIssue(`${n} new songs in the last 24 hours`, { kind: "song_volume", count: n, threshold: env.songVolumeAlertPerDay }, "warning");
  }
  logPostHogInfo("song_request_created", {
    quiz_version: fromQuiz ? "story-v1" : "classic",
    generation_deferred: true,
  });
  after(() => runBriefing(row.id));
  const res = NextResponse.json({ id: row.id }, { status: 201 });
  res.headers.append("Set-Cookie", projectCookie(row.id, token));
  return res;
}

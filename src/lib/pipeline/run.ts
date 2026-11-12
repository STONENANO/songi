/**
 * The song pipeline, part 1: briefing and lyrics. Every exported function is
 * one state transition and is safe to call twice.
 *
 *  draft -> briefing -> (needs_input) -> writing_lyrics -> lyrics_ready
 *        -> generating -> processing -> preview_ready -> purchased | failed
 *
 * Generation and candidates live in generation.ts; the customer view in view.ts.
 */
import { and, desc, eq, ne, or, isNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { SongRequest } from "../db/schema";
import { withUsage } from "../llm/client";
import { env } from "../env";
import {
  extractBrief,
  writeLyrics,
  evaluateEditedLyrics,
  getGenre,
  normalizeBrief,
  BRIEF_VERSION,
  countIssues,
  type DraftEval,
  type QuizInput,
} from "../songcraft";
import { logEvent, setStatus, failRequest, getRequest, recordLlmUsage } from "./common";

export { getRequest } from "./common";
import { startGeneration } from "./generation";
export { startGeneration, pollIfGenerating, handleKieCallback, collectTask, advanceCandidates } from "./generation";
export { getRequestView, selectVersion } from "./view";
export type { RequestView } from "./view";

const { songRequests, lyricDrafts } = schema;

/** Story-quiz extras live in the quiz snapshot (no schema change needed). */
function quizExtras(r: SongRequest): { giverName: string; oneLine: string; leaveOut: string; autoRecord: boolean } {
  const q = (r.quizSnapshot ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  return { giverName: str("giverName"), oneLine: str("oneLine"), leaveOut: str("leaveOut"), autoRecord: q.autoRecord === true };
}

function toQuizInput(r: SongRequest): QuizInput {
  const x = quizExtras(r);
  return {
    giverName: x.giverName || null,
    oneLine: x.oneLine || null,
    leaveOut: x.leaveOut || null,
    recipientName: r.recipientName,
    pronunciation: r.pronunciation,
    relationship: r.relationship,
    occasion: r.occasion,
    story: r.story,
    genreKey: r.genreKey,
    vocalGender: r.vocalGender,
    mood: r.mood,
    customStyle: r.customStyle,
    followUpAnswers: r.followUpAnswers,
  };
}

/* ------------------------------ briefing --------------------------------- */

/** Run after the quiz is submitted (or after follow-up answers arrive). */
export async function runBriefing(requestId: string): Promise<void> {
  const r = await getRequest(requestId);
  if (!r || !["draft", "briefing", "needs_input"].includes(r.status)) return;
  try {
    await setStatus(requestId, "briefing");
    const { result: brief, usage } = await withUsage(() => extractBrief(toQuizInput(r)));
    await recordLlmUsage(requestId, usage);
    const db = await getDb();
    await db.update(songRequests).set({ brief: brief as unknown as Record<string, unknown>, briefVersion: BRIEF_VERSION, updatedAt: new Date() }).where(eq(songRequests.id, requestId));
    await logEvent(requestId, "brief:extracted", {
      facts: brief.facts.length,
      verifiedQuotes: brief.facts.filter((f) => f.provenance === "verified").length,
      omitted: brief.omittedFacts.length,
      followUps: brief.followUpQuestions.length,
      contradictions: brief.contradictions.length,
    });

    if (brief.followUpQuestions.length && !r.followUpAnswers) {
      await setStatus(requestId, "needs_input", { followUpQuestions: brief.followUpQuestions });
      return;
    }
    await runLyrics(requestId, { source: "generated" });
    await maybeAutoRecord(requestId);
  } catch (e) {
    await failRequest(requestId, e);
  }
}

/**
 * Story-quiz projects record as soon as the first verified lyrics exist, so the
 * buyer goes straight from the quiz to the wait page. Lyrics that need changes
 * stop here and the buyer sees them with the issues to fix.
 */
async function maybeAutoRecord(requestId: string): Promise<void> {
  const r = await getRequest(requestId);
  if (!r || r.status !== "lyrics_ready" || r.generationAttempts > 0 || !quizExtras(r).autoRecord) return;
  const result = await startGeneration(requestId, { trigger: "customer" });
  await logEvent(requestId, "generation:auto_record", result.ok ? { submitted: result.submitted } : { error: result.error });
}

export async function submitFollowUpAnswers(requestId: string, answers: Record<string, string>): Promise<void> {
  const r = await getRequest(requestId);
  if (!r || r.status !== "needs_input") return;
  const db = await getDb();
  await db.update(songRequests).set({ followUpAnswers: answers, updatedAt: new Date() }).where(eq(songRequests.id, requestId));
  await runBriefing(requestId);
}

/* ------------------------------- lyrics ---------------------------------- */

async function nextDraftVersion(requestId: string): Promise<number> {
  const db = await getDb();
  const [last] = await db.select({ v: lyricDrafts.version }).from(lyricDrafts).where(eq(lyricDrafts.requestId, requestId)).orderBy(desc(lyricDrafts.version)).limit(1);
  return (last?.v ?? 0) + 1;
}

/** The current draft: newest one that was not superseded by a better attempt. Legacy drafts have status null. */
export async function latestDraft(requestId: string) {
  const db = await getDb();
  const [d] = await db
    .select()
    .from(lyricDrafts)
    .where(and(eq(lyricDrafts.requestId, requestId), or(isNull(lyricDrafts.status), ne(lyricDrafts.status, "superseded"))))
    .orderBy(desc(lyricDrafts.version))
    .limit(1);
  return d ?? null;
}

async function saveDraft(requestId: string, e: DraftEval, status: "verified" | "failed" | "superseded", parentDraftId: string | null): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(lyricDrafts)
    .values({
      requestId,
      version: await nextDraftVersion(requestId),
      title: e.title,
      displayLyrics: e.displayLyrics,
      sungLyrics: e.sungLyrics,
      verifierReport: e.verifier as unknown as Record<string, unknown> | null,
      source: env.mockLlm && e.source === "generated" ? "mock" : e.source,
      status,
      validation: { issues: e.issues, notes: e.notes, counts: countIssues(e.issues) } as unknown as Record<string, unknown>,
      creative: e.verifier ? ({ scores: e.verifier.scores, weighted: e.creativeScore } as unknown as Record<string, unknown>) : null,
      arrangementId: e.arrangementId,
      plan: e.lyrics.plan as unknown as Record<string, unknown>,
      factPlacement: e.lyrics.factPlacement,
      promptVersion: e.promptVersion,
      parentDraftId,
    })
    .returning({ id: lyricDrafts.id });
  return row.id;
}

export async function runLyrics(requestId: string, opts: { source: "generated" | "regenerated" }): Promise<void> {
  const r = await getRequest(requestId);
  const brief = normalizeBrief(r?.brief);
  if (!r || !brief) return;
  if (!["briefing", "writing_lyrics", "lyrics_ready", "preview_ready", "failed"].includes(r.status)) return;
  try {
    await setStatus(requestId, "writing_lyrics");
    const parent = await latestDraft(requestId);
    const { result, usage } = await withUsage(() =>
      writeLyrics({ brief, genre: getGenre(r.genreKey), mood: r.mood, occasion: r.occasion, variation: opts.source === "regenerated" }),
    );
    await recordLlmUsage(requestId, usage);
    // Keep every attempt for audit; the chosen one is saved last so it becomes the current draft.
    for (const a of result.attempts) if (a !== result.chosen) await saveDraft(requestId, a, "superseded", parent?.id ?? null);
    await saveDraft(requestId, result.chosen, result.chosen.status === "verified" ? "verified" : "failed", parent?.id ?? null);
    const counts = countIssues(result.chosen.issues);
    await logEvent(requestId, "lyrics:written", {
      attempts: result.attempts.length,
      status: result.chosen.status,
      arrangement: result.chosen.arrangementId,
      arrangementReason: result.arrangement.reason,
      critical: counts.critical,
      warnings: counts.warnings,
      creativeScore: result.chosen.creativeScore,
      llmCalls: usage.length,
    });
    await setStatus(requestId, "lyrics_ready", { lastError: result.chosen.status === "verified" ? null : "These lyrics need changes before they can be sung." });
  } catch (e) {
    await failRequest(requestId, e);
  }
}

/** Customer edited lines by hand. Check them (code + verifier) and store as a new draft. */
export async function submitEditedLyrics(requestId: string, text: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const r = await getRequest(requestId);
  const brief = normalizeBrief(r?.brief);
  if (!r || !brief || !["lyrics_ready", "preview_ready"].includes(r.status)) return { ok: false, error: "Lyrics cannot be edited right now." };
  const latest = await latestDraft(requestId);
  const { result, usage } = await withUsage(() =>
    evaluateEditedLyrics(text, {
      brief,
      genre: getGenre(r.genreKey),
      mood: r.mood,
      occasion: r.occasion,
      title: latest?.title ?? `A Song for ${brief.recipient.name || "You"}`,
      arrangementId: latest?.arrangementId ?? null,
      previousPlacement: latest?.factPlacement ?? [],
    }),
  );
  await recordLlmUsage(requestId, usage);
  if ("error" in result) return { ok: false, error: result.error };
  await saveDraft(requestId, result, result.status === "verified" ? "verified" : "failed", latest?.id ?? null);
  await logEvent(requestId, "lyrics:edited", { status: result.status, ...countIssues(result.issues) });
  if (r.status !== "lyrics_ready") await setStatus(requestId, "lyrics_ready");
  return { ok: true, status: result.status };
}

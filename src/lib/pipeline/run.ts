/**
 * The song pipeline. Each exported function is one state transition and is safe
 * to call twice: a second call finds the state already advanced and returns.
 *
 *  draft -> briefing -> (needs_input) -> writing_lyrics -> lyrics_ready
 *        -> generating -> processing -> preview_ready | failed
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AlignedWord, RequestStatus, SongRequest } from "../db/schema";
import { env } from "../env";
import {
  extractBrief,
  writeLyrics,
  verifyLyrics,
  parseEditedLyrics,
  renderLyrics,
  toSungLyrics,
  getGenre,
  buildKieInput,
  findProfanity,
  type Brief,
  type QuizInput,
} from "../songcraft";
import { createMusicTask, getTaskStatus, getTimestampedLyrics } from "../kie/client";
import type { KieTrack } from "../kie/types";
import { downloadToFile, probeDuration, normalizeToMp3, cutPreview } from "../audio/ffmpeg";
import { choosePreviewStart } from "../audio/preview";
import { evaluateVersion } from "../audio/quality";
import { getStorage } from "../storage";

const { songRequests, lyricDrafts, generations, songVersions, events, costLedger } = schema;

/* ------------------------------ helpers ---------------------------------- */

async function logEvent(requestId: string | null, type: string, payload: Record<string, unknown> = {}) {
  const db = await getDb();
  await db.insert(events).values({ requestId, type, payload });
}

async function setStatus(requestId: string, status: RequestStatus, extra: Partial<typeof songRequests.$inferInsert> = {}) {
  const db = await getDb();
  await db.update(songRequests).set({ status, updatedAt: new Date(), ...extra }).where(eq(songRequests.id, requestId));
  await logEvent(requestId, `status:${status}`, extra.lastError ? { error: extra.lastError } : {});
}

async function fail(requestId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pipeline] request ${requestId} failed:`, message);
  await setStatus(requestId, "failed", { lastError: message });
}

export async function getRequest(id: string): Promise<SongRequest | null> {
  const db = await getDb();
  const [row] = await db.select().from(songRequests).where(eq(songRequests.id, id)).limit(1);
  return row ?? null;
}

function toQuizInput(r: SongRequest): QuizInput {
  return {
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
    const brief = await extractBrief(toQuizInput(r));
    const db = await getDb();
    await db.update(songRequests).set({ brief, updatedAt: new Date() }).where(eq(songRequests.id, requestId));
    await logEvent(requestId, "brief:extracted", { facts: brief.facts.length, followUps: brief.followUpQuestions.length });

    if (brief.followUpQuestions.length && !r.followUpAnswers) {
      await setStatus(requestId, "needs_input", { followUpQuestions: brief.followUpQuestions });
      return;
    }
    await runLyrics(requestId, { source: "generated" });
  } catch (e) {
    await fail(requestId, e);
  }
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

export async function runLyrics(requestId: string, opts: { source: "generated" | "regenerated" }): Promise<void> {
  const r = await getRequest(requestId);
  if (!r?.brief) return;
  if (!["briefing", "writing_lyrics", "lyrics_ready", "failed"].includes(r.status)) return;
  try {
    await setStatus(requestId, "writing_lyrics");
    const brief = r.brief as unknown as Brief;
    const result = await writeLyrics({ brief, genre: getGenre(r.genreKey), mood: r.mood, variation: opts.source === "regenerated" });
    const db = await getDb();
    await db.insert(lyricDrafts).values({
      requestId,
      version: await nextDraftVersion(requestId),
      title: result.title,
      displayLyrics: result.displayLyrics,
      sungLyrics: result.sungLyrics,
      verifierReport: result.report as unknown as Record<string, unknown>,
      source: env.mockLlm ? "mock" : opts.source,
    });
    await logEvent(requestId, "lyrics:written", { attempts: result.attempts, pass: result.report.pass });
    await setStatus(requestId, "lyrics_ready");
  } catch (e) {
    await fail(requestId, e);
  }
}

/** Customer edited lines by hand. Verify, then store as a new draft. */
export async function submitEditedLyrics(requestId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await getRequest(requestId);
  if (!r?.brief || r.status !== "lyrics_ready") return { ok: false, error: "Lyrics cannot be edited right now." };
  const parsed = parseEditedLyrics(text);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const profanity = findProfanity(text);
  if (profanity.length) return { ok: false, error: `Please remove: ${profanity.join(", ")}` };
  const brief = r.brief as unknown as Brief;
  const latest = await latestDraft(requestId);
  const report = await verifyLyrics(brief, { ...parsed, title: latest?.title ?? "" });
  const display = renderLyrics(parsed);
  const db = await getDb();
  await db.insert(lyricDrafts).values({
    requestId,
    version: await nextDraftVersion(requestId),
    title: latest?.title ?? `A Song for ${brief.recipient.name || "You"}`,
    displayLyrics: display,
    sungLyrics: toSungLyrics(display, brief),
    verifierReport: report as unknown as Record<string, unknown>,
    source: "edited",
  });
  await logEvent(requestId, "lyrics:edited", { pass: report.pass });
  return { ok: true };
}

export async function latestDraft(requestId: string) {
  const db = await getDb();
  const [d] = await db.select().from(lyricDrafts).where(eq(lyricDrafts.requestId, requestId)).orderBy(desc(lyricDrafts.version)).limit(1);
  return d ?? null;
}

/* ----------------------------- generation -------------------------------- */

export async function startGeneration(requestId: string, draftId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await getRequest(requestId);
  if (!r) return { ok: false, error: "Not found" };
  if (!["lyrics_ready", "preview_ready", "failed", "processing"].includes(r.status)) {
    return { ok: false, error: `Cannot generate while status is ${r.status}` };
  }
  if (r.generationAttempts >= env.maxGenerationAttempts * 3) {
    return { ok: false, error: "This request has used all of its generation tries." };
  }
  const db = await getDb();
  const draft = draftId
    ? (await db.select().from(lyricDrafts).where(and(eq(lyricDrafts.id, draftId), eq(lyricDrafts.requestId, requestId))).limit(1))[0]
    : await latestDraft(requestId);
  if (!draft) return { ok: false, error: "No lyrics to sing yet." };

  try {
    await db.update(lyricDrafts).set({ approved: true }).where(eq(lyricDrafts.id, draft.id));
    const { input, registryVersion, sanitized } = buildKieInput({
      genreKey: r.genreKey,
      vocalGender: r.vocalGender,
      mood: r.mood,
      customStyle: r.customStyle,
      title: draft.title,
      sungLyrics: draft.sungLyrics,
      kieModel: env.kieModel,
    });
    const callBackUrl = `${env.appUrl}/api/webhooks/kie?secret=${encodeURIComponent(env.kieWebhookSecret)}`;
    const taskId = await createMusicTask(input, callBackUrl);
    await db.insert(generations).values({
      requestId,
      lyricDraftId: draft.id,
      providerTaskId: taskId,
      registryVersion,
      requestPayload: { ...input, sanitizedOut: sanitized } as unknown as Record<string, unknown>,
    });
    await db.insert(costLedger).values({ requestId, provider: "kie-suno", operation: "generate", units: 1, costUsd: "0.15" });
    await setStatus(requestId, "generating", { generationAttempts: r.generationAttempts + 1, lastError: null });
    await logEvent(requestId, "generation:submitted", { taskId, registryVersion });
    return { ok: true };
  } catch (e) {
    await fail(requestId, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Called by the Kie.ai webhook and by the polling fallback. Claims the
 * generation row atomically so the heavy processing runs exactly once.
 */
export async function handleTaskResult(taskId: string, result: { ok: true; tracks: KieTrack[] } | { ok: false; error: string }): Promise<void> {
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.providerTaskId, taskId)).limit(1);
  if (!gen) {
    console.warn(`[pipeline] callback for unknown task ${taskId}`);
    return;
  }
  const claimed = await db
    .update(generations)
    .set({ status: result.ok ? "complete" : "failed", error: result.ok ? null : result.error, completedAt: new Date() })
    .where(and(eq(generations.id, gen.id), eq(generations.status, "submitted")))
    .returning({ id: generations.id });
  if (!claimed.length) return; // already handled

  if (!result.ok) {
    await logEvent(gen.requestId, "generation:failed", { taskId, error: result.error });
    await retryOrFail(gen.requestId, `Music generation failed: ${result.error}`);
    return;
  }

  await setStatus(gen.requestId, "processing");
  const [draft] = await db.select().from(lyricDrafts).where(eq(lyricDrafts.id, gen.lyricDraftId)).limit(1);
  const r = await getRequest(gen.requestId);
  if (!draft || !r) return;

  let readyCount = 0;
  for (const track of result.tracks) {
    try {
      const ok = await processTrack({ request: r, generationId: gen.id, taskId, track, sungLyrics: draft.sungLyrics, title: draft.title });
      if (ok) readyCount++;
    } catch (e) {
      console.error(`[pipeline] track ${track.id} failed`, e);
      await logEvent(gen.requestId, "version:error", { audioId: track.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (readyCount > 0) {
    await setStatus(gen.requestId, "preview_ready");
  } else {
    await retryOrFail(gen.requestId, "Every rendered version failed the quality check.");
  }
}

async function retryOrFail(requestId: string, reason: string) {
  const r = await getRequest(requestId);
  if (!r) return;
  if (r.generationAttempts < env.maxGenerationAttempts) {
    await logEvent(requestId, "generation:auto-retry", { reason, attempt: r.generationAttempts + 1 });
    const db = await getDb();
    await db.update(songRequests).set({ status: "lyrics_ready", lastError: reason }).where(eq(songRequests.id, requestId));
    await startGeneration(requestId);
  } else {
    await fail(requestId, reason);
  }
}

async function processTrack(opts: {
  request: SongRequest;
  generationId: string;
  taskId: string;
  track: KieTrack;
  sungLyrics: string;
  title: string;
}): Promise<boolean> {
  const { request, generationId, taskId, track } = opts;
  const db = await getDb();
  const storage = await getStorage();
  const genre = getGenre(request.genreKey);

  const [version] = await db
    .insert(songVersions)
    .values({ generationId, requestId: request.id, providerAudioId: track.id, title: track.title ?? opts.title, imageUrl: track.image_url ?? null })
    .onConflictDoNothing()
    .returning();
  if (!version) return false; // duplicate callback for this track

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "song-"));
  try {
    const raw = path.join(tmp, "raw.mp3");
    const full = path.join(tmp, "full.mp3");
    const preview = path.join(tmp, "preview.mp3");
    await downloadToFile(track.audio_url, raw);
    await normalizeToMp3(raw, full);
    const duration = await probeDuration(full);

    let aligned: AlignedWord[] | null = null;
    try {
      const words = await getTimestampedLyrics(taskId, track.id);
      aligned = words.map((w) => ({ word: w.word, startS: w.startS, endS: w.endS, success: w.success }));
      await db.insert(costLedger).values({ requestId: request.id, provider: "kie-suno", operation: "timestamped-lyrics", units: 1, costUsd: "0.002" });
    } catch (e) {
      await logEvent(request.id, "version:no-timestamps", { audioId: track.id, error: e instanceof Error ? e.message : String(e) });
    }

    const quality = evaluateVersion({
      sungLyrics: opts.sungLyrics,
      aligned,
      duration,
      targetDuration: genre.blueprint.targetDuration,
      minCoverage: env.minLyricCoverage,
    });

    const brief = request.brief as unknown as Brief | null;
    const names = [brief?.recipient.name ?? request.recipientName ?? "", brief?.recipient.sungAs ?? ""].filter(Boolean);
    const choice = choosePreviewStart({ aligned: aligned ?? [], names, duration, previewSeconds: env.previewSeconds });
    await cutPreview(full, preview, choice.start, Math.min(env.previewSeconds, duration));

    const base = `requests/${request.id}/versions/${version.id}`;
    await storage.putFile(`${base}/full.mp3`, full, "audio/mpeg");
    await storage.putFile(`${base}/preview.mp3`, preview, "audio/mpeg");

    await db
      .update(songVersions)
      .set({
        audioKey: `${base}/full.mp3`,
        previewKey: `${base}/preview.mp3`,
        duration,
        previewStart: choice.start,
        alignedWords: aligned,
        quality: { ...quality, previewReason: choice.reason } as unknown as Record<string, unknown>,
        status: quality.pass ? "ready" : "rejected",
      })
      .where(eq(songVersions.id, version.id));
    await logEvent(request.id, quality.pass ? "version:ready" : "version:rejected", { audioId: track.id, ...quality, previewReason: choice.reason });
    return quality.pass;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ------------------------------- polling --------------------------------- */

const lastPoll = new Map<string, number>();
const POLL_INTERVAL_MS = 8000;

/** Fallback when the callback never arrives (local dev without a tunnel, or a lost webhook). */
export async function pollIfGenerating(requestId: string): Promise<void> {
  const r = await getRequest(requestId);
  if (!r || r.status !== "generating") return;
  const db = await getDb();
  const [gen] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.requestId, requestId), eq(generations.status, "submitted")))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  if (!gen?.providerTaskId) return;
  const now = Date.now();
  if (now - (lastPoll.get(gen.id) ?? 0) < POLL_INTERVAL_MS) return;
  lastPoll.set(gen.id, now);

  const status = await getTaskStatus(gen.providerTaskId);
  if (status.state === "success" && status.tracks.length) {
    await handleTaskResult(gen.providerTaskId, { ok: true, tracks: status.tracks });
  } else if (status.state === "fail") {
    await handleTaskResult(gen.providerTaskId, { ok: false, error: status.failMsg ?? "unknown provider failure" });
  }
}

/* --------------------------------- view ---------------------------------- */

/** Everything the request page needs, in one shape. */
export async function getRequestView(requestId: string) {
  const r = await getRequest(requestId);
  if (!r) return null;
  const db = await getDb();
  const storage = await getStorage();
  const drafts = await db.select().from(lyricDrafts).where(eq(lyricDrafts.requestId, requestId)).orderBy(desc(lyricDrafts.version));
  const versions = await db.select().from(songVersions).where(eq(songVersions.requestId, requestId)).orderBy(desc(songVersions.createdAt));
  const brief = r.brief as unknown as Brief | null;
  return {
    id: r.id,
    status: r.status,
    lastError: r.lastError,
    createdAt: r.createdAt,
    recipientName: r.recipientName,
    relationship: r.relationship,
    occasion: r.occasion,
    genreKey: r.genreKey,
    genreLabel: getGenre(r.genreKey).label,
    vocalGender: r.vocalGender,
    mood: r.mood,
    generationAttempts: r.generationAttempts,
    maxGenerationAttempts: env.maxGenerationAttempts,
    brief: brief
      ? { summary: brief.summary, facts: brief.facts, tone: brief.tone, recipient: brief.recipient, avoid: brief.avoid }
      : null,
    followUpQuestions: r.followUpQuestions ?? [],
    drafts: drafts.map((d) => ({
      id: d.id,
      version: d.version,
      title: d.title,
      displayLyrics: d.displayLyrics,
      source: d.source,
      approved: d.approved,
      report: d.verifierReport,
    })),
    versions: versions
      .filter((v) => v.status !== "pending")
      .map((v) => ({
        id: v.id,
        title: v.title,
        status: v.status,
        duration: v.duration,
        previewStart: v.previewStart,
        previewUrl: v.previewKey ? storage.publicUrl(v.previewKey) : null,
        imageUrl: v.imageUrl,
        quality: v.quality,
      })),
    mock: { llm: env.mockLlm, kie: env.mockKie },
  };
}
export type RequestView = NonNullable<Awaited<ReturnType<typeof getRequestView>>>;

/**
 * Process one returned track: download it safely, run technical QA, normalise,
 * align lyrics, cut a chorus-first preview, store everything privately and
 * score it for candidate selection. Idempotent per provider audio id.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AlignedWord, Generation, LyricDraft, SongRequest } from "../db/schema";
import { env } from "../env";
import { getGenre, normalizeBrief, styleSummary, getArrangement, type MusicDirection } from "../songcraft";
import { assertSafeAudioUrl, getTimestampedLyrics } from "../kie/client";
import type { KieTrack } from "../kie/types";
import { downloadToFile, probeDuration, normalizeToMp3, cutPreview } from "../audio/ffmpeg";
import { choosePreviewStart } from "../audio/preview";
import { evaluateVersion } from "../audio/quality";
import { technicalQa } from "../audio/qa";
import { getStorage } from "../storage";
import { logEvent } from "./common";

const { songVersions, costLedger } = schema;

/** Heuristic ranking score. Higher is better. Not a measure of musical quality. */
export function scoreTrack(t: { coverage: number; nameHeard: boolean; duration: number; requested: number | null; techWarnings: number }): number {
  const fit = t.requested ? Math.max(0, 1 - Math.abs(t.duration - t.requested) / t.requested) : 0.5;
  return Math.round((t.coverage * 4 + (t.nameHeard ? 2 : 0) + fit * 2 - t.techWarnings * 0.5) * 100) / 100;
}

export async function processTrack(opts: { request: SongRequest; generation: Generation; draft: LyricDraft; track: KieTrack }): Promise<boolean> {
  const { request, generation, draft, track } = opts;
  const db = await getDb();
  const storage = await getStorage();
  const direction = generation.musicDirection as unknown as MusicDirection | null;
  const payload = generation.requestPayload as { duration?: number };
  const requested = payload.duration ?? null;

  const [version] = await db
    .insert(songVersions)
    .values({
      generationId: generation.id,
      requestId: request.id,
      providerAudioId: track.id,
      title: track.title ?? draft.title,
      imageUrl: track.image_url ?? null,
      variantId: direction?.archetype ?? generation.variantId,
      variantLabel: direction?.variantLabel ?? null,
      styleSummary: direction ? styleSummary(direction) : null,
      requestedDuration: requested,
      sourceAudioUrl: track.audio_url,
    })
    .onConflictDoNothing()
    .returning();
  if (!version) return false; // duplicate delivery of the same track

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "song-"));
  const base = `requests/${request.id}/versions/${version.id}`;
  try {
    const raw = path.join(tmp, "raw.audio");
    assertSafeAudioUrl(track.audio_url);
    await downloadToFile(track.audio_url, raw);

    const tech = await technicalQa(raw, { requestedDuration: requested });
    if (!tech.pass) {
      // Keep the raw file for internal review; it is never offered.
      await storage.putFile(`${base}/raw-rejected.audio`, raw, "application/octet-stream");
      await db.update(songVersions).set({ status: "rejected", audioQa: tech as unknown as Record<string, unknown>, quality: { pass: false, reasons: tech.reasons, stage: "technical" }, duration: tech.duration || null }).where(eq(songVersions.id, version.id));
      await logEvent(request.id, "version:rejected", { audioId: track.id, stage: "technical", reasons: tech.reasons });
      return false;
    }

    const full = path.join(tmp, "full.mp3");
    const preview = path.join(tmp, "preview.mp3");
    await normalizeToMp3(raw, full, { title: draft.title, lyrics: draft.displayLyrics });
    const duration = await probeDuration(full);

    let aligned: AlignedWord[] | null = null;
    try {
      const words = await getTimestampedLyrics(generation.providerTaskId!, track.id);
      aligned = words.map((w) => ({ word: w.word, startS: w.startS, endS: w.endS, success: w.success }));
      await db.insert(costLedger).values({ requestId: request.id, provider: env.mockKie ? "kie-suno-mock" : "kie-suno", operation: "timestamped-lyrics", units: 1, costUsd: env.mockKie ? "0" : "0.002" });
    } catch (e) {
      await logEvent(request.id, "version:no-timestamps", { audioId: track.id, error: (e as Error).message });
    }

    const genre = getGenre(request.genreKey);
    const arrangement = getArrangement(draft.arrangementId, genre);
    const lyricQa = evaluateVersion({ sungLyrics: draft.sungLyrics, aligned, duration, targetDuration: requested ?? arrangement.duration[0], minCoverage: env.minLyricCoverage });

    const brief = normalizeBrief(request.brief);
    const names = [brief?.recipient.name ?? request.recipientName ?? "", brief?.recipient.sungAs ?? "", ...(brief?.recipient.nicknames ?? [])].filter(Boolean);
    const lower = names.map((n) => n.toLowerCase().split(/[\s-]+/)[0]);
    const nameHeard = !!aligned?.some((w) => w.success && lower.some((n) => n && w.word.toLowerCase().replace(/\[[^\]]*\]\s*/g, "").replace(/[^a-z'-]/g, "").startsWith(n)));

    const choice = choosePreviewStart({ aligned: aligned ?? [], names, duration, previewSeconds: env.previewSeconds });
    await cutPreview(full, preview, choice.start, Math.min(env.previewSeconds, duration));
    await storage.putFile(`${base}/full.mp3`, full, "audio/mpeg");
    await storage.putFile(`${base}/preview.mp3`, preview, "audio/mpeg");

    const ready = lyricQa.pass;
    const score = scoreTrack({ coverage: lyricQa.coverage, nameHeard, duration, requested, techWarnings: tech.warnings.length });
    await db
      .update(songVersions)
      .set({
        audioKey: `${base}/full.mp3`,
        previewKey: `${base}/preview.mp3`,
        duration,
        previewStart: choice.start,
        alignedWords: aligned,
        audioQa: tech as unknown as Record<string, unknown>,
        quality: { ...lyricQa, stage: "lyrics", previewReason: choice.reason, note: "Timestamp alignment is a heuristic, not proof every word was sung correctly." } as unknown as Record<string, unknown>,
        nameHeard,
        score,
        status: ready ? "ready" : "rejected",
      })
      .where(eq(songVersions.id, version.id));
    await logEvent(request.id, ready ? "version:ready" : "version:rejected", { audioId: track.id, variant: direction?.archetype, coverage: lyricQa.coverage, nameHeard, score, duration, requested, previewReason: choice.reason, reasons: lyricQa.reasons });
    return ready;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

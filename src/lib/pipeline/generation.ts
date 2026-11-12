/**
 * Candidate generation: turn one verified lyric sheet into 2-3 preview
 * versions with the fewest reasonable Kie.ai tasks, under an explicit budget.
 *
 * Strategy (defaults; all configurable in env.ts):
 *  - One lyric sheet, several musical interpretations (archetypes).
 *  - A task returns ~2 tracks, so 3 versions need 2 tasks. Both are submitted
 *    up front with different archetypes (signature, then intimate) to keep the
 *    customer's wait to one generation cycle.
 *  - Every returned track goes through QA. If too few pass, one more task is
 *    submitted with the next archetype, while budget remains.
 *  - Up to DESIRED_CANDIDATES distinct versions are offered; fewer if that is
 *    all that passed. Zero usable after the budget = failed, never a loop.
 *
 * Idempotency: each task has a unique key (project, draft, slot); a second
 * submit for the same slot is a no-op. Callbacks carry our generation id so a
 * task whose creation response was lost can still be reconciled.
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Generation, LyricDraft, SongRequest } from "../db/schema";
import { env } from "../env";
import { buildKieInput, draftIsSingable, genreArchetypes, getGenre, normalizeBrief, styleSummary, GenerationInputError, type Archetype, type MusicDirection } from "../songcraft";
import { AmbiguousSubmitError, callbackUrl, createMusicTask, getTaskStatus, KieError } from "../kie/client";
import { logEvent, setStatus, failRequest, getRequest } from "./common";
import { processTrack } from "./process";

const { songRequests, lyricDrafts, generations, songVersions, costLedger } = schema;

const IN_FLIGHT = ["pending", "submitted", "unknown", "collecting"] as const;

/* ------------------------------ planning (pure) --------------------------- */

export function plannedArchetypes(genreKey: string, mode: "distinct" | "same_style"): Archetype[] {
  const all = genreArchetypes(getGenre(genreKey));
  return mode === "same_style" ? ["signature"] : all;
}

/** Tasks to submit up front for a new round. */
export function initialTaskCount(cfg: { desired: number; expectedTracks: number; collection: "collect" | "per_task"; maxAuto: number }): number {
  const n = cfg.collection === "per_task" ? cfg.desired : Math.ceil(cfg.desired / cfg.expectedTracks);
  return Math.max(1, Math.min(n, cfg.maxAuto));
}

export type BudgetInput = { draftTasks: number; projectTasks: number; estSpentUsd: number; trigger: "auto" | "retry" | "customer" | "extra" };
export type BudgetConfig = { maxAutoTasks: number; maxTasksPerProject: number; maxEstSpendUsd: number; taskCostUsd: number };

/** Can one more task be submitted? Pure, so it can be unit-tested. */
export function canSubmitTask(b: BudgetInput, c: BudgetConfig): { ok: boolean; reason?: string } {
  if (b.projectTasks >= c.maxTasksPerProject) return { ok: false, reason: `project task cap (${c.maxTasksPerProject}) reached` };
  if (b.estSpentUsd + c.taskCostUsd > c.maxEstSpendUsd + 1e-9) return { ok: false, reason: `estimated spend cap ($${c.maxEstSpendUsd.toFixed(2)}) reached` };
  if ((b.trigger === "auto" || b.trigger === "retry") && b.draftTasks >= c.maxAutoTasks) return { ok: false, reason: `automatic task cap (${c.maxAutoTasks}) reached for these lyrics` };
  return { ok: true };
}

export function budgetConfig(): BudgetConfig {
  return { maxAutoTasks: env.maxAutoTasks, maxTasksPerProject: env.maxTasksPerProject, maxEstSpendUsd: env.maxEstSpendUsd, taskCostUsd: env.kieTaskCostUsd };
}

async function budgetInput(requestId: string, draftId: string, trigger: BudgetInput["trigger"]): Promise<BudgetInput> {
  const db = await getDb();
  const all = await db.select({ draftId: generations.lyricDraftId, est: generations.estCostUsd }).from(generations).where(eq(generations.requestId, requestId));
  return {
    draftTasks: all.filter((g) => g.draftId === draftId).length,
    projectTasks: all.length,
    estSpentUsd: all.reduce((s, g) => s + Number(g.est ?? 0), 0),
    trigger,
  };
}

/* ------------------------------- submission ------------------------------- */

async function submitTask(r: SongRequest, draft: LyricDraft, slot: number, archetype: Archetype, trigger: "customer" | "auto" | "retry" | "extra"): Promise<"submitted" | "unknown" | "failed" | "exists"> {
  const db = await getDb();
  const brief = normalizeBrief(r.brief);
  const experiment = (r.experiment ?? {}) as { directionMode?: "director" | "legacy"; vocalMode?: "specific" | "generic" };
  const built = buildKieInput({
    genreKey: r.genreKey,
    vocalGender: r.vocalGender,
    mood: r.mood,
    customStyle: r.customStyle,
    title: draft.title,
    sungLyrics: draft.sungLyrics,
    kieModel: env.kieModel,
    allowedModels: env.kieAllowedModels,
    arrangementId: draft.arrangementId,
    archetype,
    relationship: brief?.recipient.relationship ?? r.relationship,
    occasion: r.occasion,
    variantIndex: slot,
    directionMode: experiment.directionMode,
    vocalMode: experiment.vocalMode,
  });

  const [gen] = await db
    .insert(generations)
    .values({
      requestId: r.id,
      lyricDraftId: draft.id,
      status: "pending",
      idempotencyKey: `${r.id}:${draft.id}:${slot}`,
      slot,
      trigger: trigger === "extra" ? "customer" : trigger,
      model: built.input.model,
      variantId: built.direction?.archetype ?? "legacy",
      registryVersion: built.registryVersion,
      presetVersion: built.presetVersion,
      promptVersion: draft.promptVersion ?? "legacy",
      musicDirection: built.direction as unknown as Record<string, unknown> | null,
      requestPayload: { ...built.input, styleReport: built.styleReport, sanitizedOut: built.sanitized } as unknown as Record<string, unknown>,
      estCostUsd: env.kieTaskCostUsd.toFixed(4),
    })
    .onConflictDoNothing()
    .returning();
  if (!gen) return "exists";

  try {
    const taskId = await createMusicTask(built.input, callbackUrl(gen.id));
    await db.update(generations).set({ providerTaskId: taskId, status: "submitted", submittedAt: new Date() }).where(eq(generations.id, gen.id));
    await db.insert(costLedger).values({ requestId: r.id, provider: env.mockKie ? "kie-suno-mock" : "kie-suno", operation: "generate", units: 1, costUsd: env.mockKie ? "0" : env.kieTaskCostUsd.toFixed(4) });
    await logEvent(r.id, "generation:submitted", { generationId: gen.id, taskId, slot, archetype: built.direction?.archetype, trigger, model: built.input.model, registryVersion: built.registryVersion, presetVersion: built.presetVersion, dropped: built.styleReport.dropped, conflicts: built.direction?.conflicts ?? [] });
    return "submitted";
  } catch (e) {
    if (e instanceof AmbiguousSubmitError) {
      // The task may exist (and be billed). Wait for a callback carrying this generation id; do not resubmit.
      await db.update(generations).set({ status: "unknown", error: e.message, submittedAt: new Date() }).where(eq(generations.id, gen.id));
      await db.insert(costLedger).values({ requestId: r.id, provider: "kie-suno", operation: "generate_unconfirmed", units: 1, costUsd: env.kieTaskCostUsd.toFixed(4) });
      await logEvent(r.id, "generation:unconfirmed", { generationId: gen.id, error: e.message });
      return "unknown";
    }
    // Definite failure: no task was created, nothing billed.
    await db.update(generations).set({ status: "failed", error: (e as Error).message, estCostUsd: "0", completedAt: new Date() }).where(eq(generations.id, gen.id));
    await logEvent(r.id, "generation:failed", { generationId: gen.id, error: (e as Error).message, retryable: e instanceof KieError ? e.retryable : false });
    return "failed";
  }
}

async function nextSlot(draftId: string): Promise<number> {
  const db = await getDb();
  const [last] = await db.select({ slot: generations.slot }).from(generations).where(eq(generations.lyricDraftId, draftId)).orderBy(desc(generations.slot)).limit(1);
  return last?.slot === null || last?.slot === undefined ? 0 : last.slot + 1;
}

/**
 * Start a round of generation for the current (or given) draft.
 * trigger "customer": first round after "Sing it". trigger "extra": customer asked for another take.
 */
export async function startGeneration(requestId: string, opts: { draftId?: string; trigger?: "customer" | "extra" } = {}): Promise<{ ok: true; submitted: number } | { ok: false; error: string }> {
  const r = await getRequest(requestId);
  if (!r) return { ok: false, error: "Not found" };
  if (!["lyrics_ready", "preview_ready", "failed"].includes(r.status)) return { ok: false, error: "Your song isn't ready to record right now. This page updates on its own." };
  const db = await getDb();
  const draft = opts.draftId
    ? (await db.select().from(lyricDrafts).where(and(eq(lyricDrafts.id, opts.draftId), eq(lyricDrafts.requestId, requestId))).limit(1))[0]
    : (await db.select().from(lyricDrafts).where(and(eq(lyricDrafts.requestId, requestId), or(isNull(lyricDrafts.status), ne(lyricDrafts.status, "superseded")))).orderBy(desc(lyricDrafts.version)).limit(1))[0];
  if (!draft) return { ok: false, error: "No lyrics to sing yet." };

  // The gate: only verified lyrics (or legacy drafts that passed the v1 verifier) can reach Suno.
  if (!draftIsSingable(draft)) {
    await logEvent(requestId, "generation:blocked", { draftId: draft.id, status: draft.status });
    return { ok: false, error: "These lyrics have unresolved issues. Edit them or ask for new lyrics before recording." };
  }

  const sameDraft = r.activeDraftId === draft.id;
  const trigger = opts.trigger ?? (sameDraft && r.status === "preview_ready" ? "extra" : "customer");
  const archetypes = plannedArchetypes(r.genreKey, env.variantMode);
  const count = trigger === "extra" ? 1 : initialTaskCount({ desired: env.desiredCandidates, expectedTracks: env.expectedTracksPerTask, collection: env.candidateCollection, maxAuto: env.maxAutoTasks });

  const budget = canSubmitTask(await budgetInput(requestId, draft.id, trigger), budgetConfig());
  if (!budget.ok) return { ok: false, error: "You've used all the recordings for this song." };

  await db.update(lyricDrafts).set({ approved: true }).where(eq(lyricDrafts.id, draft.id));
  if (!sameDraft) {
    // New lyrics: previous versions stop being offered (purchased ones are kept as they are).
    await db.update(songVersions).set({ offered: false, selected: false }).where(and(eq(songVersions.requestId, requestId), ne(songVersions.purchaseStatus, "paid")));
  }
  await setStatus(requestId, "generating", {
    activeDraftId: draft.id,
    candidatesFinalizedAt: null,
    selectedVersionId: sameDraft ? r.selectedVersionId : null,
    generationAttempts: r.generationAttempts + 1,
    lastError: null,
  });

  let submitted = 0;
  let lastFailure = "";
  for (let i = 0; i < count; i++) {
    const b = canSubmitTask(await budgetInput(requestId, draft.id, i === 0 ? trigger : "auto"), budgetConfig());
    if (!b.ok) break;
    const slot = await nextSlot(draft.id);
    try {
      const res = await submitTask(r, draft, slot, archetypes[slot % archetypes.length], i === 0 ? trigger : "auto");
      if (res === "submitted" || res === "unknown") submitted++;
      if (res === "failed") lastFailure = "The music service rejected the request.";
    } catch (e) {
      lastFailure = e instanceof GenerationInputError ? e.message : (e as Error).message;
      await logEvent(requestId, "generation:input_error", { error: lastFailure });
      break;
    }
  }
  if (!submitted) {
    await failRequest(requestId, lastFailure || "Could not start the recording.");
    return { ok: false, error: lastFailure || "Could not start the recording." };
  }
  return { ok: true, submitted };
}

/* ------------------------------- collection ------------------------------- */

/** Callback entry point. Only routing data is used from the callback; results are fetched from the API. */
export async function handleKieCallback(args: { generationId: string | null; taskId: string | null; code: number; msg: string }): Promise<"ok" | "unknown_generation" | "mismatch"> {
  const db = await getDb();
  let gen: Generation | undefined;
  if (args.generationId) [gen] = await db.select().from(generations).where(eq(generations.id, args.generationId)).limit(1);
  else if (args.taskId) [gen] = await db.select().from(generations).where(eq(generations.providerTaskId, args.taskId)).limit(1);
  if (!gen) return "unknown_generation";
  if (args.taskId && gen.providerTaskId && gen.providerTaskId !== args.taskId) return "mismatch";
  if (!gen.providerTaskId && args.taskId) {
    // Reconcile a task whose creation response was lost.
    await db.update(generations).set({ providerTaskId: args.taskId, status: "submitted", error: null }).where(and(eq(generations.id, gen.id), isNull(generations.providerTaskId)));
    await logEvent(gen.requestId, "generation:reconciled", { generationId: gen.id, taskId: args.taskId });
  }
  await collectTask(gen.id);
  return "ok";
}

/** Fetch the authoritative task result and process its tracks exactly once. */
export async function collectTask(generationId: string): Promise<void> {
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId)).limit(1);
  if (!gen || !gen.providerTaskId || !["submitted", "unknown"].includes(gen.status)) return;

  let status;
  try {
    status = await getTaskStatus(gen.providerTaskId);
  } catch (e) {
    await logEvent(gen.requestId, "generation:status_error", { generationId, error: (e as Error).message });
    return;
  }
  if (status.state !== "success" && status.state !== "fail") return;

  const claimed = await db
    .update(generations)
    .set({ status: "collecting" })
    .where(and(eq(generations.id, gen.id), inArray(generations.status, ["submitted", "unknown"])))
    .returning({ id: generations.id });
  if (!claimed.length) return;

  if (status.state === "fail") {
    await db.update(generations).set({ status: "failed", error: status.failMsg ?? "provider failure", creditsConsumed: status.creditsConsumed, completedAt: new Date() }).where(eq(generations.id, gen.id));
    await logEvent(gen.requestId, "generation:failed", { generationId, error: status.failMsg });
    await advanceCandidates(gen.requestId);
    return;
  }
  if (!status.tracks.length) {
    await db.update(generations).set({ status: "failed", error: `Provider reported success with no valid tracks (${status.invalidTracks} invalid).`, creditsConsumed: status.creditsConsumed, trackCount: 0, completedAt: new Date() }).where(eq(generations.id, gen.id));
    await logEvent(gen.requestId, "generation:empty", { generationId, invalid: status.invalidTracks });
    await advanceCandidates(gen.requestId);
    return;
  }

  const r = await getRequest(gen.requestId);
  const [draft] = await db.select().from(lyricDrafts).where(eq(lyricDrafts.id, gen.lyricDraftId)).limit(1);
  if (!r || !draft) return;
  if (r.status === "generating") await setStatus(r.id, "processing");

  let usable = 0;
  for (const track of status.tracks) {
    try {
      if (await processTrack({ request: r, generation: gen, draft, track })) usable++;
    } catch (e) {
      console.error(`[pipeline] track ${track.id} failed`, e);
      await logEvent(gen.requestId, "version:error", { audioId: track.id, error: (e as Error).message });
    }
  }
  await db.update(generations).set({ status: "complete", trackCount: status.tracks.length, creditsConsumed: status.creditsConsumed, completedAt: new Date() }).where(eq(generations.id, gen.id));
  await logEvent(gen.requestId, "generation:collected", { generationId, tracks: status.tracks.length, usable, credits: status.creditsConsumed });
  await advanceCandidates(gen.requestId);
}

/* ------------------------------- candidates ------------------------------- */

type Candidate = { id: string; score: number; variantId: string | null; slot: number; generationId: string; selected: boolean };

/** Pick up to `desired` versions, preferring one per musical variant, then by score. Pure. */
export function selectCandidates(cands: Candidate[], desired: number, collection: "collect" | "per_task"): Candidate[] {
  const byScore = [...cands].sort((a, b) => b.score - a.score || a.slot - b.slot);
  const picked: Candidate[] = [];
  const add = (c: Candidate) => {
    if (picked.length < desired && !picked.includes(c)) picked.push(c);
  };
  const sel = cands.find((c) => c.selected);
  if (sel) add(sel);
  if (collection === "per_task") {
    const gens = [...new Set([...cands].sort((a, b) => a.slot - b.slot).map((c) => c.generationId))];
    for (const g of gens) {
      const best = byScore.find((c) => c.generationId === g);
      if (best) add(best);
    }
    return picked;
  }
  const variants = [...new Set([...cands].sort((a, b) => a.slot - b.slot).map((c) => c.variantId ?? ""))];
  for (const v of variants) {
    if (picked.some((p) => (p.variantId ?? "") === v)) continue;
    const best = byScore.find((c) => (c.variantId ?? "") === v);
    if (best) add(best);
  }
  for (const c of byScore) add(c);
  return picked;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function finalize(r: SongRequest, draftId: string): Promise<void> {
  const db = await getDb();
  // One transaction: the song becomes preview_ready together with its offered versions. A page
  // polling in between would otherwise see "ready" with nothing to offer and show the error screen.
  const ordered = await db.transaction(async (tx) => {
    const won = await tx
      .update(songRequests)
      .set({ status: "preview_ready", candidatesFinalizedAt: new Date(), updatedAt: new Date(), lastError: null })
      .where(and(eq(songRequests.id, r.id), inArray(songRequests.status, ["generating", "processing"])))
      .returning({ id: songRequests.id });
    if (!won.length) return null;

    const rows = await tx
      .select({ id: songVersions.id, score: songVersions.score, variantId: songVersions.variantId, slot: generations.slot, generationId: songVersions.generationId, selected: songVersions.selected })
      .from(songVersions)
      .innerJoin(generations, eq(songVersions.generationId, generations.id))
      .where(and(eq(songVersions.requestId, r.id), eq(generations.lyricDraftId, draftId), eq(songVersions.status, "ready"), eq(songVersions.availability, "available")));
    const picked = selectCandidates(
      rows.map((x) => ({ ...x, score: x.score ?? 0, slot: x.slot ?? 0 })),
      env.desiredCandidates,
      env.candidateCollection,
    );
    const list = env.randomizeCandidateOrder ? shuffle(picked) : picked;
    await tx.update(songVersions).set({ offered: false, offerRank: null }).where(and(eq(songVersions.requestId, r.id), ne(songVersions.purchaseStatus, "paid")));
    for (const [i, c] of list.entries()) await tx.update(songVersions).set({ offered: true, offerRank: i }).where(eq(songVersions.id, c.id));
    return { list, usable: rows.length };
  });
  if (!ordered) return;
  await logEvent(r.id, "status:preview_ready", {});
  await logEvent(r.id, "candidates:finalized", {
    offered: ordered.list.map((c, i) => ({ id: c.id, variant: c.variantId, score: c.score, rank: i })),
    usable: ordered.usable,
    randomized: env.randomizeCandidateOrder,
  });
}

/** Decide what happens next for the active round. Called after every task completes or fails. */
export async function advanceCandidates(requestId: string): Promise<void> {
  const r = await getRequest(requestId);
  if (!r?.activeDraftId || !["generating", "processing"].includes(r.status)) return;
  const db = await getDb();
  const draftId = r.activeDraftId;
  const gens = await db.select().from(generations).where(eq(generations.lyricDraftId, draftId)).orderBy(asc(generations.slot));
  const inflight = gens.filter((g) => (IN_FLIGHT as readonly string[]).includes(g.status));
  const usable = await db
    .select({ id: songVersions.id })
    .from(songVersions)
    .innerJoin(generations, eq(songVersions.generationId, generations.id))
    .where(and(eq(songVersions.requestId, requestId), eq(generations.lyricDraftId, draftId), eq(songVersions.status, "ready")));

  if (usable.length >= env.desiredCandidates) return finalize(r, draftId);
  if (inflight.length > 0) return;

  const trigger = usable.length === 0 ? "retry" : "auto";
  const budget = canSubmitTask(await budgetInput(requestId, draftId, trigger), budgetConfig());
  if (budget.ok) {
    const [draft] = await db.select().from(lyricDrafts).where(eq(lyricDrafts.id, draftId)).limit(1);
    const archetypes = plannedArchetypes(r.genreKey, env.variantMode);
    const slot = await nextSlot(draftId);
    await logEvent(requestId, "generation:followup", { reason: usable.length ? `only ${usable.length} usable version(s)` : "no usable versions yet", slot });
    try {
      const res = await submitTask(r, draft, slot, archetypes[slot % archetypes.length], trigger);
      if (res === "submitted" || res === "unknown" || res === "exists") return;
    } catch (e) {
      await logEvent(requestId, "generation:input_error", { error: (e as Error).message });
    }
  }
  if (usable.length >= env.minCandidates) return finalize(r, draftId);
  await failRequest(requestId, `We couldn't produce a recording that passed our checks after ${gens.length} attempt(s). ${budget.ok ? "" : `(${budget.reason})`}`.trim());
}

/* --------------------------------- polling -------------------------------- */

const lastPoll = new Map<string, number>();
const POLL_INTERVAL_MS = 8000;

/**
 * Fallback when callbacks don't arrive (local dev, lost webhook): check
 * in-flight tasks, time out stuck ones, then advance the round.
 */
export async function pollIfGenerating(requestId: string, opts: { force?: boolean } = {}): Promise<void> {
  const r = await getRequest(requestId);
  if (!r?.activeDraftId || !["generating", "processing"].includes(r.status)) return;
  const now = Date.now();
  if (!opts.force && now - (lastPoll.get(requestId) ?? 0) < POLL_INTERVAL_MS) return;
  lastPoll.set(requestId, now);
  const db = await getDb();

  const inflight = await db.select().from(generations).where(and(eq(generations.lyricDraftId, r.activeDraftId), inArray(generations.status, [...IN_FLIGHT])));
  for (const g of inflight) {
    if (g.providerTaskId && (g.status === "submitted" || g.status === "unknown")) await collectTask(g.id);
  }
  // Time out what is still stuck.
  const cutoff = new Date(now - env.taskTimeoutMs);
  const stuck = await db
    .update(generations)
    .set({ status: "failed", error: "Timed out waiting for the music service.", completedAt: new Date() })
    .where(and(eq(generations.lyricDraftId, r.activeDraftId), inArray(generations.status, ["pending", "submitted", "unknown"]), lt(generations.createdAt, cutoff)))
    .returning({ id: generations.id });
  for (const s of stuck) await logEvent(requestId, "generation:timeout", { generationId: s.id });
  // Crash recovery: a collection that never finished goes back to submitted (track inserts are idempotent).
  await db.update(generations).set({ status: "submitted" }).where(and(eq(generations.lyricDraftId, r.activeDraftId), eq(generations.status, "collecting"), lt(generations.createdAt, new Date(now - 10 * 60_000))));
  await advanceCandidates(requestId);
}

export type { MusicDirection };
export { styleSummary };

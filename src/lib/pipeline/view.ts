/**
 * Everything the song page needs, in one shape.
 *
 * Media safety: the view never contains storage keys, provider URLs or a
 * full-song URL for an unpaid version. Previews are signed, short-lived URLs;
 * a full download URL appears only for a paid version and only for the owner.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { env } from "../env";
import { getGenre, normalizeBrief, draftIsSingable } from "../songcraft";
import { issueMediaToken, mediaUrl, deliveryToken } from "../media/tokens";
import { canSubmitTask, budgetConfig } from "./generation";
import { getRequest, logEvent } from "./common";
import type { Access } from "../session/project";

const { lyricDrafts, songVersions, generations, orders, songRequests, feedback } = schema;

type IssueView = { severity: string; category: string; section?: string; line?: string; reason: string };

export async function getRequestView(requestId: string, access: Access = "owner") {
  const r = await getRequest(requestId);
  if (!r) return null;
  const db = await getDb();
  const brief = normalizeBrief(r.brief);
  const drafts = await db.select().from(lyricDrafts).where(eq(lyricDrafts.requestId, requestId)).orderBy(desc(lyricDrafts.version));
  const current = drafts.find((d) => d.status !== "superseded");
  const versions = await db.select().from(songVersions).where(eq(songVersions.requestId, requestId)).orderBy(desc(songVersions.createdAt));
  const gens = await db.select().from(generations).where(eq(generations.requestId, requestId));
  const orderRows = await db.select().from(orders).where(eq(orders.requestId, requestId)).orderBy(desc(orders.createdAt));
  const [lastFeedback] = await db.select().from(feedback).where(eq(feedback.requestId, requestId)).orderBy(desc(feedback.createdAt)).limit(1);

  // Legacy projects (pre-v2) never ran candidate selection: show their ready versions.
  const legacy = r.status === "preview_ready" && !r.candidatesFinalizedAt && !versions.some((v) => v.offered);
  const offered = versions
    .filter((v) => (legacy ? v.status === "ready" : v.offered || v.purchaseStatus === "paid"))
    .sort((a, b) => (a.offerRank ?? 99) - (b.offerRank ?? 99));

  const paid = orderRows.find((o) => o.status === "paid" && o.fulfilledAt);
  const pending = orderRows.find((o) => o.status === "pending");
  const owner = access === "owner" || access === "legacy";

  // Labels describe the real style; a second take of the same style is numbered, never renamed.
  const seenLabels = new Map<string, number>();
  const candidates = offered.map((v, i) => {
    const isPaid = v.purchaseStatus === "paid";
    const base = v.variantLabel ?? `Version ${String.fromCharCode(65 + i)}`;
    const n = (seenLabels.get(base) ?? 0) + 1;
    seenLabels.set(base, n);
    return {
      id: v.id,
      label: n > 1 ? `${base} · Take ${n}` : base,
      description: v.styleSummary ?? "",
      runtimeSec: v.duration ? Math.round(v.duration) : null,
      previewStartSec: v.previewStart,
      previewUrl: v.previewKey && owner ? mediaUrl(issueMediaToken({ key: v.previewKey, kind: "preview", ttlSec: env.previewUrlTtlSec, versionId: v.id })) : null,
      selected: v.selected,
      purchaseStatus: v.purchaseStatus,
      downloadUrl:
        isPaid && owner && v.audioKey
          ? mediaUrl(issueMediaToken({ key: v.audioKey, kind: "full", ttlSec: env.downloadUrlTtlSec, versionId: v.id, filename: `${(v.title ?? "song").replace(/[^\w\- ]+/g, "").trim() || "song"}.mp3` }))
          : null,
    };
  });

  const activeGens = gens.filter((g) => g.lyricDraftId === r.activeDraftId);
  const budget = current
    ? canSubmitTask({ draftTasks: gens.filter((g) => g.lyricDraftId === current.id).length, projectTasks: gens.length, estSpentUsd: gens.reduce((s, g) => s + Number(g.estCostUsd ?? 0), 0), trigger: "extra" }, budgetConfig())
    : { ok: false };

  const validation = (current?.validation ?? null) as { issues?: IssueView[]; notes?: string[] } | null;
  const issues = (validation?.issues ?? []).filter((i) => i.severity !== "suggestion");

  const quiz = (r.quizSnapshot ?? {}) as Record<string, unknown>;
  // Which lyric lines carry which story detail, for highlighting on the song page.
  const factById = new Map((brief?.facts ?? []).map((f) => [f.id, f]));
  const storyLines = (current?.factPlacement ?? [])
    .map((p) => {
      const f = factById.get(p.factId);
      return f ? { line: p.line, fact: f.text, quote: f.sourceQuote ?? "" } : null;
    })
    .filter((x): x is { line: string; fact: string; quote: string } => !!x);

  return {
    id: r.id,
    status: r.status,
    lastError: r.lastError,
    createdAt: r.createdAt,
    /** When the current status began (status changes bump updatedAt). Drives wait-page progress. */
    statusSince: r.updatedAt,
    generationAttempts: r.generationAttempts,
    /** Story-quiz projects record automatically once verified lyrics exist. */
    autoRecord: quiz.autoRecord === true,
    giverName: (typeof quiz.giverName === "string" && quiz.giverName) || brief?.giverName || "",
    access,
    recipientName: r.recipientName,
    relationship: r.relationship,
    occasion: r.occasion,
    genreKey: r.genreKey,
    genreLabel: getGenre(r.genreKey).label,
    vocalGender: r.vocalGender,
    mood: r.mood,
    brief: brief
      ? {
          summary: brief.summary,
          emotionalThesis: brief.emotionalThesis,
          facts: brief.facts.map((f) => ({ id: f.id, text: f.text, type: f.type, priority: f.priority, sourceQuote: f.sourceQuote, provenance: f.provenance })),
          omitted: brief.omittedFacts.length,
          contradictions: brief.contradictions,
          recipient: brief.recipient,
        }
      : null,
    followUpQuestions: r.followUpQuestions ?? [],
    draft: current
      ? {
          id: current.id,
          version: current.version,
          title: current.title,
          displayLyrics: current.displayLyrics,
          status: current.status ?? (draftIsSingable(current) ? "verified" : "failed"),
          singable: draftIsSingable(current),
          blockingIssues: issues.filter((i) => i.severity === "critical"),
          warnings: issues.filter((i) => i.severity === "warning").slice(0, 6),
          notes: validation?.notes ?? [],
          creativeScore: (current.creative as { weighted?: number } | null)?.weighted ?? null,
          arrangementId: current.arrangementId,
          source: current.source,
          storyLines,
        }
      : null,
    draftCount: drafts.length,
    generation: {
      tasksInFlight: activeGens.filter((g) => ["pending", "submitted", "unknown", "collecting"].includes(g.status)).length,
      tasksTotal: activeGens.length,
      usable: versions.filter((v) => v.status === "ready" && activeGens.some((g) => g.id === v.generationId)).length,
      desired: env.desiredCandidates,
      canRequestMore: budget.ok && ["preview_ready", "failed"].includes(r.status) && !paid,
    },
    candidates,
    rejectedCount: versions.filter((v) => v.status === "rejected" && activeGens.some((g) => g.id === v.generationId)).length,
    selectedVersionId: r.selectedVersionId,
    order: paid
      ? { status: "paid" as const, versionId: paid.versionId, deliveryLink: owner ? `/d/${deliveryToken(paid.id)}` : null }
      : pending
        ? { status: "pending" as const, versionId: pending.versionId, deliveryLink: null }
        : orderRows.some((o) => o.status === "paid_unfulfilled")
          ? { status: "paid_unfulfilled" as const, versionId: orderRows.find((o) => o.status === "paid_unfulfilled")!.versionId, deliveryLink: null }
          : null,
    feedback: lastFeedback ? { rating: lastFeedback.rating, wouldPay: lastFeedback.wouldPay, note: lastFeedback.note } : null,
    priceLabel: env.freeDownloads ? "free while testing" : env.priceLabel,
    // The test-mode banner is for local development; a live test site never shows it.
    mock: { llm: env.mockLlm, kie: env.mockKie, payments: env.mockPayments, banner: !env.isProd },
  };
}
export type RequestView = NonNullable<Awaited<ReturnType<typeof getRequestView>>>;

/** Persist the customer's chosen version. Server-side check that it belongs to this project and is on offer. */
export async function selectVersion(requestId: string, versionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const [v] = await db.select().from(songVersions).where(and(eq(songVersions.id, versionId), eq(songVersions.requestId, requestId))).limit(1);
  if (!v || !(v.offered || v.purchaseStatus === "paid") || v.status !== "ready") return { ok: false, error: "That version is not available." };
  await db.update(songVersions).set({ selected: false }).where(and(eq(songVersions.requestId, requestId), inArray(songVersions.purchaseStatus, ["none", "pending", "refunded"])));
  await db.update(songVersions).set({ selected: true }).where(eq(songVersions.id, versionId));
  await db.update(songRequests).set({ selectedVersionId: versionId, updatedAt: new Date() }).where(eq(songRequests.id, requestId));
  await logEvent(requestId, "candidate:selected", { versionId, variant: v.variantId, rank: v.offerRank });
  return { ok: true };
}

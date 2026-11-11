/**
 * Read-only data for the /admin pages: every test song with its lyrics,
 * takes, costs and tester feedback. Access is checked by adminAllowed().
 */
import crypto from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "./db";
import { env } from "./env";
import { getGenre } from "./songcraft";
import { issueMediaToken, mediaUrl } from "./media/tokens";

const { songRequests, lyricDrafts, songVersions, generations, orders, feedback, costLedger, events } = schema;

/** ADMIN_TOKEN is required in production. Locally, /admin is open when no token is set. */
export function adminAllowed(token: string | undefined): boolean {
  const want = env.adminToken;
  if (!want) return !env.isProd;
  if (!token || token.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(want));
}

const money = (rows: { provider: string; costUsd: string | null }[], prefix: string) =>
  rows.filter((r) => r.provider.startsWith(prefix)).reduce((s, r) => s + Number(r.costUsd ?? 0), 0);

export async function adminList(limit = 100) {
  const db = await getDb();
  const reqs = await db.select().from(songRequests).orderBy(desc(songRequests.createdAt)).limit(limit);
  if (!reqs.length) return [];
  const ids = reqs.map((r) => r.id);
  const [drafts, versions, fb, costs, ords] = await Promise.all([
    db.select({ id: lyricDrafts.id, requestId: lyricDrafts.requestId, title: lyricDrafts.title, creative: lyricDrafts.creative, promptVersion: lyricDrafts.promptVersion }).from(lyricDrafts).where(inArray(lyricDrafts.requestId, ids)),
    db.select({ id: songVersions.id, requestId: songVersions.requestId, label: songVersions.variantLabel, selected: songVersions.selected, offered: songVersions.offered, status: songVersions.status }).from(songVersions).where(inArray(songVersions.requestId, ids)),
    db.select().from(feedback).where(inArray(feedback.requestId, ids)).orderBy(desc(feedback.createdAt)),
    db.select({ requestId: costLedger.requestId, provider: costLedger.provider, costUsd: costLedger.costUsd }).from(costLedger).where(inArray(costLedger.requestId, ids)),
    db.select({ requestId: orders.requestId, status: orders.status }).from(orders).where(inArray(orders.requestId, ids)),
  ]);
  return reqs.map((r) => {
    const d = drafts.find((x) => x.id === r.activeDraftId);
    const vs = versions.filter((v) => v.requestId === r.id);
    const f = fb.find((x) => x.requestId === r.id) ?? null;
    const c = costs.filter((x) => x.requestId === r.id);
    return {
      id: r.id,
      createdAt: r.createdAt,
      recipient: r.recipientName || "(no name)",
      relationship: r.relationship,
      occasion: r.occasion,
      genre: getGenre(r.genreKey).label,
      status: r.status,
      title: d?.title ?? null,
      score: ((d?.creative as { weighted?: number } | null)?.weighted ?? null) as number | null,
      writer: d?.promptVersion ?? null,
      takes: vs.filter((v) => v.offered).length,
      chosen: vs.find((v) => v.selected)?.label ?? null,
      paid: ords.some((o) => o.requestId === r.id && o.status === "paid"),
      feedback: f ? { rating: f.rating, wouldPay: f.wouldPay, note: f.note } : null,
      llmUsd: money(c, "anthropic"),
      kieUsd: money(c, "kie"),
    };
  });
}

export async function adminDetail(id: string) {
  const db = await getDb();
  const [r] = await db.select().from(songRequests).where(eq(songRequests.id, id)).limit(1);
  if (!r) return null;
  const [drafts, versions, gens, fb, costs, evs] = await Promise.all([
    db.select().from(lyricDrafts).where(eq(lyricDrafts.requestId, id)).orderBy(desc(lyricDrafts.version)),
    db.select().from(songVersions).where(eq(songVersions.requestId, id)).orderBy(songVersions.offerRank),
    db.select().from(generations).where(eq(generations.requestId, id)),
    db.select().from(feedback).where(eq(feedback.requestId, id)).orderBy(desc(feedback.createdAt)),
    db.select().from(costLedger).where(eq(costLedger.requestId, id)),
    db.select().from(events).where(eq(events.requestId, id)).orderBy(desc(events.createdAt)).limit(40),
  ]);
  const active = drafts.find((d) => d.id === r.activeDraftId) ?? drafts[0] ?? null;
  const brief = r.brief as { summary?: string; facts?: { id: string; text: string; priority: number }[] } | null;
  return {
    request: { id: r.id, createdAt: r.createdAt, status: r.status, recipient: r.recipientName, pronunciation: r.pronunciation, relationship: r.relationship, occasion: r.occasion, genre: getGenre(r.genreKey).label, vocal: r.vocalGender, mood: r.mood, customStyle: r.customStyle, story: r.story, followUps: r.followUpAnswers, lastError: r.lastError },
    brief: brief ? { summary: brief.summary ?? "", facts: brief.facts ?? [] } : null,
    draft: active
      ? {
          title: active.title,
          lyrics: active.displayLyrics,
          status: active.status,
          score: (active.creative as { weighted?: number } | null)?.weighted ?? null,
          promptVersion: active.promptVersion,
          arrangement: active.arrangementId,
          plan: active.plan,
          issues: ((active.validation as { issues?: { severity: string; section?: string; reason: string }[] } | null)?.issues ?? []).filter((i) => i.severity !== "suggestion"),
        }
      : null,
    draftsWritten: drafts.length,
    takes: versions.map((v) => ({
      id: v.id,
      label: v.variantLabel ?? "Version",
      style: v.styleSummary,
      status: v.status,
      offered: v.offered,
      selected: v.selected,
      paid: v.purchaseStatus === "paid",
      duration: v.duration,
      // Admin hears the full take; the token still expires.
      audioUrl: v.audioKey ? mediaUrl(issueMediaToken({ key: v.audioKey, kind: "full", ttlSec: 3600, versionId: v.id })) : null,
      qa: v.audioQa,
    })),
    feedback: fb,
    cost: { llmUsd: money(costs, "anthropic"), kieUsd: money(costs, "kie"), kieTasks: gens.length },
    events: evs.map((e) => ({ type: e.type, at: e.createdAt, payload: e.payload })),
  };
}

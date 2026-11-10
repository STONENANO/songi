import "../setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../src/lib/db";
import { runBriefing, startGeneration, pollIfGenerating, getRequestView, selectVersion, handleKieCallback, latestDraft } from "../../src/lib/pipeline/run";
import { startCheckout, handleShopifyWebhook, mockPaidOrderPayload } from "../../src/lib/commerce/orders";
import { signShopifyBody } from "../../src/lib/commerce/shopify";
import { mockKieControl } from "../../src/lib/kie/client";
import { songcraftHooks, resetMockCounters } from "../../src/lib/songcraft/mock";
import { getStorage } from "../../src/lib/storage";
import { newProjectToken } from "../../src/lib/session/project";
import { issueMediaToken } from "../../src/lib/media/tokens";
import { env } from "../../src/lib/env";
import { GET as mediaGET } from "../../src/app/api/media/[token]/route";

const STORY = "Mom taught me to make pancakes every Sunday. She sings off-key in the car on every road trip. Her happy place is the lake house in Michigan. She still beats everyone at cards.";

async function project(over: Partial<typeof schema.songRequests.$inferInsert> = {}) {
  const db = await getDb();
  const [r] = await db
    .insert(schema.songRequests)
    .values({ recipientName: "Linda", relationship: "mom", occasion: "birthday", story: STORY, genreKey: "country", vocalGender: "f", mood: "heartfelt", accessTokenHash: newProjectToken().hash, ...over })
    .returning();
  return r.id;
}

async function untilSettled(id: string, max = 40) {
  for (let i = 0; i < max; i++) {
    await pollIfGenerating(id, { force: true });
    const v = await getRequestView(id);
    if (v && ["preview_ready", "failed", "purchased"].includes(v.status)) return v;
  }
  return getRequestView(id);
}

async function gensFor(id: string) {
  const db = await getDb();
  return db.select().from(schema.generations).where(eq(schema.generations.requestId, id));
}
async function versionsFor(id: string) {
  const db = await getDb();
  return db.select().from(schema.songVersions).where(eq(schema.songVersions.requestId, id));
}

function paidWebhook(orderId: string, versionId: string, eventId: string, shopifyId?: number) {
  const payload = mockPaidOrderPayload(orderId, versionId);
  if (shopifyId) payload.id = shopifyId;
  const raw = JSON.stringify(payload);
  return { raw, headers: new Headers({ "x-shopify-hmac-sha256": signShopifyBody(raw, env.mockShopifyWebhookSecret), "x-shopify-topic": "orders/paid", "x-shopify-event-id": eventId }) };
}

beforeEach(() => {
  delete songcraftHooks.writer;
  delete songcraftHooks.verifier;
  delete songcraftHooks.brief;
  resetMockCounters();
  mockKieControl.reset();
});

test("verified lyrics reach Kie; 3 versions come from 2 tasks in different styles; media stays private", async () => {
  const id = await project();
  await runBriefing(id);
  const pre = await getRequestView(id);
  assert.equal(pre?.draft?.status, "verified");
  const g = await startGeneration(id);
  assert.deepEqual(g, { ok: true, submitted: 2 });
  const v = await untilSettled(id);
  assert.equal(v?.status, "preview_ready");
  assert.equal(v?.candidates.length, 3);

  const gens = await gensFor(id);
  assert.equal(gens.length, 2);
  assert.deepEqual(gens.map((x) => x.variantId).sort(), ["intimate", "signature"]);
  assert.ok(gens.every((x) => x.idempotencyKey && x.registryVersion && x.presetVersion && x.promptVersion && x.musicDirection));
  const vers = await versionsFor(id);
  assert.equal(vers.length, 4, "every track from both tasks is kept");
  assert.equal(new Set(vers.map((x) => x.providerAudioId)).size, 4);
  assert.equal(vers.filter((x) => x.offered).length, 3);
  assert.ok(new Set(v!.candidates.map((c) => c.label)).size >= 2, "offered versions differ in style");

  const storage = await getStorage();
  for (const x of vers) {
    assert.ok(await storage.exists(x.audioKey!), "full song stored durably");
    assert.ok(await storage.exists(x.previewKey!));
  }
  const json = JSON.stringify(v);
  assert.ok(v!.candidates.every((c) => c.previewUrl?.startsWith("/api/media/") && c.downloadUrl === null));
  assert.ok(!json.includes("full.mp3") && !json.includes("file://") && !json.includes("audio_url"), "no storage keys or provider URLs leak");
});

test("a draft with critical failures can never reach Kie", async () => {
  songcraftHooks.writer = ({ brief, arrangement }) => ({
    plan: { thesis: "", centralDetail: "", payoff: "", hookConcept: "", verseRoles: [], ending: "" },
    arrangementId: arrangement.id,
    title: "No Name",
    sections: arrangement.sections.filter((s) => !s.optional).map((s) => ({ tag: s.tag, lines: Array.from({ length: s.minLines }, (_, i) => `${s.tag} line ${i} about ${brief.facts[0]?.text ?? "x"}`) })),
    factPlacement: [],
    namePlacementNote: "",
  });
  const id = await project();
  await runBriefing(id);
  const v = await getRequestView(id);
  assert.equal(v?.draft?.status, "failed");
  assert.equal(v?.draft?.singable, false);
  const before = mockKieControl.taskCount;
  const g = await startGeneration(id);
  assert.equal(g.ok, false);
  assert.equal(mockKieControl.taskCount, before, "no provider task created");
  assert.equal((await gensFor(id)).length, 0);
});

test("duplicate callbacks for one task never duplicate tracks", async () => {
  const id = await project();
  await runBriefing(id);
  await startGeneration(id);
  const [gen] = await gensFor(id);
  await Promise.all([1, 2, 3].map(() => handleKieCallback({ generationId: gen.id, taskId: gen.providerTaskId, code: 200, msg: "" })));
  const vers = (await versionsFor(id)).filter((x) => x.generationId === gen.id);
  assert.equal(vers.length, 2);
});

test("callbacks naming a different task than the generation are rejected", async () => {
  const id = await project();
  await runBriefing(id);
  await startGeneration(id);
  const [gen] = await gensFor(id);
  assert.equal(await handleKieCallback({ generationId: gen.id, taskId: "someone-elses-task", code: 200, msg: "" }), "mismatch");
});

test("partial results trigger one bounded follow-up task in a new style", async () => {
  mockKieControl.queue({ tracks: 1 }, { tracks: 2, kinds: ["silent", "tone"] }, {});
  const id = await project();
  await runBriefing(id);
  await startGeneration(id);
  const v = await untilSettled(id);
  assert.equal(v?.status, "preview_ready");
  const gens = (await gensFor(id)).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  assert.equal(gens.length, 3);
  assert.equal(gens[2].trigger, "auto");
  assert.equal(gens[2].variantId, "expressive");
  assert.equal(v?.rejectedCount, 1, "silent track rejected by audio QA");
  assert.equal(v?.candidates.length, 3);
});

test("repeated failures stop at the task cap and fail the request", async () => {
  mockKieControl.queue({ fail: "provider down" }, { fail: "provider down" }, { fail: "provider down" }, { fail: "provider down" });
  const id = await project();
  await runBriefing(id);
  await startGeneration(id);
  const v = await untilSettled(id);
  assert.equal(v?.status, "failed");
  assert.equal((await gensFor(id)).length, env.maxAutoTasks);
  assert.match(v?.lastError ?? "", /couldn't produce/);
});

test("a task reported successful with zero valid tracks counts as a failure", async () => {
  mockKieControl.queue({ empty: true }, {}, {});
  const id = await project();
  await runBriefing(id);
  await startGeneration(id);
  await untilSettled(id);
  const gens = (await gensFor(id)).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  assert.equal(gens[0].status, "failed");
  assert.match(gens[0].error ?? "", /no valid tracks/);
});

test("a lost submit response is not resubmitted; the callback reconciles it", async () => {
  mockKieControl.queue({ ambiguous: true }, {});
  const id = await project();
  await runBriefing(id);
  await startGeneration(id);
  let gens = (await gensFor(id)).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  assert.equal(gens[0].status, "unknown");
  assert.equal(gens[0].providerTaskId, null);
  const lostTaskId = (await import("../../src/lib/kie/client")).mockKieControl.lastTaskId;
  // The second slot was created after the first; the first's task id is the one before it.
  const firstTask = [...(globalThis as unknown as { __kieMock: Map<string, unknown> }).__kieMock.keys()][0];
  assert.ok(lostTaskId);
  assert.equal(await handleKieCallback({ generationId: gens[0].id, taskId: firstTask, code: 200, msg: "" }), "ok");
  gens = (await gensFor(id)).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  assert.equal(gens[0].providerTaskId, firstTask);
  assert.equal(gens[0].status, "complete");
  assert.equal(gens.length, 2, "no duplicate paid task was created");
});

test("selection persists; only the purchased version unlocks; duplicate and second payments never double-fulfil", async () => {
  const id = await project();
  await runBriefing(id);
  await startGeneration(id);
  const v = await untilSettled(id);
  const [a, b] = v!.candidates;
  assert.deepEqual(await selectVersion(id, b.id), { ok: true });
  assert.equal((await getRequestView(id))?.candidates.find((c) => c.selected)?.id, b.id);

  const co = await startCheckout(id, a.id);
  assert.ok(co.ok);
  if (!co.ok) return;
  assert.match(co.checkoutUrl, /\/checkout\/mock\//);
  const again = await startCheckout(id, a.id);
  assert.ok(again.ok && again.reused, "abandoned checkout is reused, not duplicated");

  // Browser returns before payment: nothing unlocked.
  assert.ok((await getRequestView(id))!.candidates.every((c) => !c.downloadUrl));
  assert.equal((await getRequestView(id))?.order?.status, "pending");

  const bad = paidWebhook(co.orderId, a.id, "evt-bad");
  assert.equal((await handleShopifyWebhook(bad.raw + " ", bad.headers)).status, 401, "tampered body rejected");

  const w = paidWebhook(co.orderId, a.id, "evt-1");
  assert.equal((await handleShopifyWebhook(w.raw, w.headers)).result, "fulfilled");
  assert.equal((await handleShopifyWebhook(w.raw, w.headers)).result, "duplicate_delivery");
  const other = paidWebhook(co.orderId, a.id, "evt-2", 123456789);
  assert.equal((await handleShopifyWebhook(other.raw, other.headers)).result, "duplicate_payment");

  const after = await getRequestView(id);
  assert.equal(after?.status, "purchased");
  const paid = after!.candidates.filter((c) => c.downloadUrl);
  assert.deepEqual(paid.map((c) => c.id), [a.id]);
  assert.ok(after?.order?.deliveryLink?.startsWith("/d/"));
  const db = await getDb();
  const ords = await db.select().from(schema.orders).where(eq(schema.orders.requestId, id));
  assert.equal(ords.filter((o) => o.status === "paid").length, 1);
  assert.equal(ords.filter((o) => o.status === "duplicate_payment").length, 1);

  // Full media: the paid version serves; an unpaid version's full file is refused even with a valid token.
  const paidRes = await mediaGET(new Request("http://x/"), { params: Promise.resolve({ token: paid[0].downloadUrl!.split("/").pop()! }) });
  assert.equal(paidRes.status, 200);
  assert.match(paidRes.headers.get("content-disposition") ?? "", /attachment/);
  const unpaid = (await versionsFor(id)).find((x) => x.id === b.id)!;
  const forged = issueMediaToken({ key: unpaid.audioKey!, kind: "full", ttlSec: 60, versionId: unpaid.id });
  assert.equal((await mediaGET(new Request("http://x/"), { params: Promise.resolve({ token: forged }) })).status, 403);

  // Refund revokes access.
  const order = ords.find((o) => o.status === "paid")!;
  const refund = JSON.stringify({ id: 1, order_id: order.shopifyOrderId });
  const rh = new Headers({ "x-shopify-hmac-sha256": signShopifyBody(refund, env.mockShopifyWebhookSecret), "x-shopify-topic": "refunds/create", "x-shopify-event-id": "evt-refund" });
  assert.equal((await handleShopifyWebhook(refund, rh)).result, "refunded");
  const tok = paid[0].downloadUrl!.split("/").pop()!;
  assert.equal((await mediaGET(new Request("http://x/"), { params: Promise.resolve({ token: tok }) })).status, 403);
});

test("a version from another project cannot be selected or bought", async () => {
  const a = await project();
  const b = await project({ recipientName: "Ray", relationship: "dad" });
  for (const id of [a, b]) {
    await runBriefing(id);
    await startGeneration(id);
    await untilSettled(id);
  }
  const vb = (await getRequestView(b))!.candidates[0];
  assert.equal((await selectVersion(a, vb.id)).ok, false);
  const co = await startCheckout(a, vb.id);
  assert.equal(co.ok, false);
  if (!co.ok) assert.equal(co.status, 404);
});

test("existing v1 records stay readable and singable", async () => {
  const db = await getDb();
  const [r] = await db
    .insert(schema.songRequests)
    .values({ recipientName: "Dave", relationship: "dad", occasion: "fathers_day", story: "He coached my team.", genreKey: "rock", status: "preview_ready", brief: { recipient: { name: "Dave", sungAs: "", relationship: "dad", pronouns: "he" }, occasion: "Father's Day", facts: [{ type: "memory", text: "Coached my team", priority: 1 }], tone: [], mustInclude: ["Dave"], avoid: [], summary: "A rock song for Dave", followUpQuestions: [] } })
    .returning();
  const [d] = await db.insert(schema.lyricDrafts).values({ requestId: r.id, version: 1, title: "Dave", displayLyrics: "[Chorus]\nDave you were there", sungLyrics: "[Chorus]\nDave you were there", verifierReport: { pass: true }, source: "generated" }).returning();
  const [g] = await db.insert(schema.generations).values({ requestId: r.id, lyricDraftId: d.id, providerTaskId: "old-task", registryVersion: "2026-11-09.1", requestPayload: {}, status: "complete" }).returning();
  await db.insert(schema.songVersions).values({ generationId: g.id, requestId: r.id, providerAudioId: "old-audio", status: "ready", previewKey: `requests/${r.id}/versions/x/preview.mp3`, audioKey: `requests/${r.id}/versions/x/full.mp3`, duration: 150 });
  const v = await getRequestView(r.id, "legacy");
  assert.equal(v?.brief?.facts[0].provenance, "legacy");
  assert.equal(v?.draft?.singable, true);
  assert.equal(v?.candidates.length, 1, "legacy ready versions are shown");
  assert.equal(v?.candidates[0].downloadUrl, null);
  assert.equal((await latestDraft(r.id))?.id, d.id);
});

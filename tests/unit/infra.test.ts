import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { extractTracks, verifyKieSignature, verifyCallbackParams, callbackUrl, assertSafeAudioUrl } from "../../src/lib/kie/client";
import { issueMediaToken, verifyMediaToken, deliveryToken, verifyDeliveryToken } from "../../src/lib/media/tokens";
import { verifyEvent, signForTests } from "../../src/lib/commerce/stripe";
import { initialTaskCount, canSubmitTask, selectCandidates } from "../../src/lib/pipeline/generation";
import { scoreTrack } from "../../src/lib/pipeline/process";

test("track extraction handles alternate shapes, dedupes ids and counts invalid records", () => {
  const shapeA = { sunoData: [{ id: "a", audioUrl: "https://x/a.mp3", duration: 120 }, { id: "a", audioUrl: "https://x/a.mp3" }] };
  const shapeB = { data: { data: [{ id: "b", audio_url: "https://x/b.mp3" }, { id: "c", audio_url: 42 }] } };
  assert.deepEqual(extractTracks(shapeA).tracks.map((t) => t.id), ["a"]);
  const b = extractTracks(shapeB);
  assert.deepEqual(b.tracks.map((t) => t.id), ["b"]);
  assert.equal(b.invalid, 1);
  assert.equal(extractTracks({ resultUrls: [] }).tracks.length, 0);
});

test("Kie webhook signature: valid, tampered, and stale timestamps", () => {
  const key = "hmac-key";
  const now = 1_800_000_000;
  const sig = crypto.createHmac("sha256", key).update(`task123.${now}`).digest("base64");
  assert.equal(verifyKieSignature("task123", String(now), sig, key, now), true);
  assert.equal(verifyKieSignature("task999", String(now), sig, key, now), false);
  assert.equal(verifyKieSignature("task123", String(now - 3600), sig, key, now), false);
});

test("our callback URLs are bound to one generation", () => {
  const u = new URL(callbackUrl("gen-1"));
  assert.equal(verifyCallbackParams("gen-1", u.searchParams.get("sig")), true);
  assert.equal(verifyCallbackParams("gen-2", u.searchParams.get("sig")), false);
});

test("audio URLs: https public hosts only; file:// only in mock mode", () => {
  assert.ok(assertSafeAudioUrl("https://cdn.example.com/a.mp3"));
  for (const bad of ["http://cdn.example.com/a.mp3", "https://127.0.0.1/a.mp3", "https://localhost/a", "https://user:pw@cdn.example.com/a", "https://10.0.0.5/a.mp3", "ftp://x/a"]) {
    assert.throws(() => assertSafeAudioUrl(bad), Error, bad);
  }
  assert.ok(assertSafeAudioUrl("file:///tmp/a.mp3"), "allowed in mock mode");
});

test("media tokens expire, resist tampering, and preview tokens cannot reach full songs", () => {
  const t = issueMediaToken({ key: "requests/r/versions/v/preview.mp3", kind: "preview", ttlSec: 60 }, 1_000_000);
  assert.ok(verifyMediaToken(t, 1_000_000));
  assert.equal(verifyMediaToken(t, 1_000_000 + 61_000), null, "expired");
  const [p, s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ k: "requests/r/versions/v/full.mp3", t: "preview", x: 9e9 })).toString("base64url");
  assert.equal(verifyMediaToken(`${forged}.${s}`), null);
  assert.equal(verifyMediaToken(`${p}.${s.slice(1)}x`), null);
  assert.throws(() => issueMediaToken({ key: "requests/r/versions/v/full.mp3", kind: "preview", ttlSec: 60 }));
  const id = crypto.randomUUID();
  assert.equal(verifyDeliveryToken(deliveryToken(id)), id);
  assert.equal(verifyDeliveryToken(`${id}.nope`), null);
});

test("Stripe webhook signatures are checked over the raw body", () => {
  const raw = JSON.stringify({ id: "evt_1", object: "event", type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } });
  const sig = signForTests(raw, "whsec_one");
  assert.equal(verifyEvent(raw, sig, "whsec_one")?.id, "evt_1");
  assert.equal(verifyEvent(raw + " ", sig, "whsec_one"), null, "tampered body");
  assert.equal(verifyEvent(raw, sig, "whsec_two"), null, "wrong secret");
  assert.equal(verifyEvent(raw, null, "whsec_one"), null, "no signature");
});

test("generation budget: initial tasks, caps and spend", () => {
  assert.equal(initialTaskCount({ desired: 3, expectedTracks: 2, collection: "collect", maxAuto: 3 }), 2);
  assert.equal(initialTaskCount({ desired: 2, expectedTracks: 2, collection: "collect", maxAuto: 3 }), 1);
  assert.equal(initialTaskCount({ desired: 3, expectedTracks: 2, collection: "per_task", maxAuto: 3 }), 3);
  const cfg = { maxAutoTasks: 3, maxTasksPerProject: 5, maxEstSpendUsd: 0.75, taskCostUsd: 0.15 };
  assert.equal(canSubmitTask({ draftTasks: 2, projectTasks: 2, estSpentUsd: 0.3, trigger: "auto" }, cfg).ok, true);
  assert.equal(canSubmitTask({ draftTasks: 3, projectTasks: 3, estSpentUsd: 0.45, trigger: "auto" }, cfg).ok, false);
  assert.equal(canSubmitTask({ draftTasks: 3, projectTasks: 3, estSpentUsd: 0.45, trigger: "extra" }, cfg).ok, true, "customer extra take ignores the auto cap");
  assert.equal(canSubmitTask({ draftTasks: 0, projectTasks: 5, estSpentUsd: 0, trigger: "extra" }, cfg).ok, false, "project cap");
  assert.equal(canSubmitTask({ draftTasks: 0, projectTasks: 1, estSpentUsd: 0.7, trigger: "customer" }, cfg).ok, false, "spend cap");
});

test("candidate selection prefers one per style, then score, and keeps the customer's pick", () => {
  const c = (id: string, score: number, variantId: string, slot: number, selected = false) => ({ id, score, variantId, slot, generationId: `g${slot}`, selected });
  const cands = [c("s1", 9, "signature", 0), c("s2", 8, "signature", 0), c("i1", 5, "intimate", 1), c("i2", 4, "intimate", 1)];
  assert.deepEqual(selectCandidates(cands, 3, "collect").map((x) => x.id), ["s1", "i1", "s2"]);
  assert.deepEqual(selectCandidates(cands, 2, "per_task").map((x) => x.id), ["s1", "i1"]);
  assert.deepEqual(selectCandidates([...cands.slice(0, 3), c("i2", 4, "intimate", 1, true)], 2, "collect").map((x) => x.id), ["i2", "s1"]);
  assert.ok(scoreTrack({ coverage: 0.9, nameHeard: true, duration: 170, requested: 170, techWarnings: 0 }) > scoreTrack({ coverage: 0.9, nameHeard: false, duration: 100, requested: 170, techWarnings: 1 }));
});

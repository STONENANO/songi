import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { getDb, schema } from "../../src/lib/db";
import { newProjectToken, cookieName } from "../../src/lib/session/project";
import { POST as trackPOST } from "../../src/app/api/track/route";
import { POST as createPOST } from "../../src/app/api/requests/route";
import { POST as answersPOST } from "../../src/app/api/requests/[id]/answers/route";
import { POST as lyricsPOST } from "../../src/app/api/requests/[id]/lyrics/route";
import { POST as feedbackPOST } from "../../src/app/api/requests/[id]/feedback/route";
import { POST as selectPOST } from "../../src/app/api/requests/[id]/select/route";
import { POST as eventsPOST } from "../../src/app/api/requests/[id]/events/route";
import { POST as checkoutPOST } from "../../src/app/api/requests/[id]/checkout/route";
import { POST as generatePOST } from "../../src/app/api/requests/[id]/generate/route";
import { POST as probePOST } from "../../src/app/api/probe/route";
import { POST as mockPayPOST } from "../../src/app/api/dev/mock-pay/route";
import { POST as stripePOST } from "../../src/app/api/webhooks/stripe/route";
import { POST as kiePOST } from "../../src/app/api/webhooks/kie/route";

const json = (url: string, body: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });

/**
 * Status of a handler call, or "accepted" when it got as far as scheduling background work:
 * Next's after() only runs inside a real server request and throws in unit tests, and the
 * handlers call it only once a request has passed every check.
 */
async function outcome(call: () => Promise<Response>): Promise<number | "accepted"> {
  try {
    return (await call()).status;
  } catch (e) {
    if (/`after` was called outside a request scope/.test((e as Error).message)) return "accepted";
    throw e;
  }
}

async function eventCount(type: string): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.events).where(sql`${schema.events.type} = ${type}`);
  return n;
}

/** A song owned by the returned cookie. */
async function ownedProject() {
  const db = await getDb();
  const { token, hash } = newProjectToken();
  const [r] = await db.insert(schema.songRequests).values({ relationship: "friend", occasion: "birthday", story: "A long enough story.", genreKey: "pop", accessTokenHash: hash, status: "needs_input" }).returning({ id: schema.songRequests.id });
  return { id: r.id, cookie: `${cookieName(r.id)}=${token}` };
}

/* ------------------------------- analytics events ------------------------------- */

test("analytics: a normal event is stored", async () => {
  const before = await eventCount("quiz:hardening_ok");
  const res = await trackPOST(json("http://localhost/api/track", JSON.stringify({ type: "quiz:hardening_ok", sessionId: "s1", payload: { step: "who", index: 1 } })));
  assert.equal(res.status, 204);
  assert.equal(await eventCount("quiz:hardening_ok"), before + 1);
});

test("analytics: a payload with too many fields is not stored", async () => {
  const payload = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
  const res = await trackPOST(json("http://localhost/api/track", JSON.stringify({ type: "quiz:hardening_wide", sessionId: "s1", payload })));
  assert.equal(res.status, 204, "fire-and-forget: the client never sees an error");
  assert.equal(await eventCount("quiz:hardening_wide"), 0);
});

test("analytics: an oversized body is refused before it reaches the database (the 84 MB audit case)", async () => {
  const payload = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, "x".repeat(200)]));
  const res = await trackPOST(json("http://localhost/api/track", JSON.stringify({ type: "quiz:hardening_big", sessionId: "s1", payload })));
  assert.equal(res.status, 413);
  assert.equal(await eventCount("quiz:hardening_big"), 0);
});

/* ------------------------- every route refuses huge bodies ------------------------- */

test("every JSON route answers an oversized body with 413", async () => {
  const p = await ownedProject();
  const ctx = { params: Promise.resolve({ id: p.id }) };
  const huge = JSON.stringify({ pad: "x".repeat(1_100_000) }); // over every cap, including webhooks
  const auth = { cookie: p.cookie, "x-forwarded-for": "10.77.0.1" };
  const base = `http://localhost/api/requests/${p.id}`;
  const routes: [string, () => Promise<Response>][] = [
    ["create", () => createPOST(json("http://localhost/api/requests", huge, { "x-forwarded-for": "10.77.0.2" }))],
    ["answers", () => answersPOST(json(`${base}/answers`, huge, auth), ctx)],
    ["lyrics", () => lyricsPOST(json(`${base}/lyrics`, huge, auth), ctx)],
    ["feedback", () => feedbackPOST(json(`${base}/feedback`, huge, auth), ctx)],
    ["select", () => selectPOST(json(`${base}/select`, huge, auth), ctx)],
    ["events", () => eventsPOST(json(`${base}/events`, huge, auth), ctx)],
    ["checkout", () => checkoutPOST(json(`${base}/checkout`, huge, auth), ctx)],
    ["generate", () => generatePOST(json(`${base}/generate`, huge, auth), ctx)],
    ["probe", () => probePOST(json("http://localhost/api/probe", huge, { "x-forwarded-for": "10.77.0.3" }))],
    ["mock-pay", () => mockPayPOST(json("http://localhost/api/dev/mock-pay", huge, auth))],
    ["stripe webhook", () => stripePOST(json("http://localhost/api/webhooks/stripe", huge, { "stripe-signature": "t=1,v1=x" }))],
    ["kie webhook", () => kiePOST(json("http://localhost/api/webhooks/kie?secret=test-kie-secret", huge))],
  ];
  for (const [name, call] of routes) {
    const res = await call();
    assert.equal(res.status, 413, name);
  }
});

test("a lie in Content-Length is refused before the body is read", async () => {
  const res = await probePOST(json("http://localhost/api/probe", "{}", { "content-length": "50000000", "x-forwarded-for": "10.77.0.4" }));
  assert.equal(res.status, 413);
});

test("body limits leave normal requests alone (create, feedback, generate with an empty body)", async () => {
  const created = await outcome(() =>
    createPOST(json("http://localhost/api/requests", JSON.stringify({ relationship: "friend", occasion: "birthday", story: "She bakes bread every Saturday morning.", genreKey: "pop" }), { "x-forwarded-for": "10.77.0.5" })),
  );
  assert.equal(created, "accepted", "the song was saved and its briefing scheduled");
  const p = await ownedProject();
  const ctx = { params: Promise.resolve({ id: p.id }) };
  const fb = await feedbackPOST(json(`http://localhost/api/requests/${p.id}/feedback`, JSON.stringify({ rating: 5 }), { cookie: p.cookie }), ctx);
  assert.equal(fb.status, 200);
  const gen = await generatePOST(new Request(`http://localhost/api/requests/${p.id}/generate`, { method: "POST", headers: { cookie: p.cookie } }), ctx);
  assert.notEqual(gen.status, 413);
  assert.notEqual(gen.status, 400);
});

test("follow-up answers: more than 10 answers are refused", async () => {
  const p = await ownedProject();
  const answers = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`Question ${i}?`, "An answer."]));
  const res = await answersPOST(json(`http://localhost/api/requests/${p.id}/answers`, JSON.stringify({ answers }), { cookie: p.cookie }), { params: Promise.resolve({ id: p.id }) });
  assert.equal(res.status, 400);
});

/* ------------------------------- Kie callback secret ------------------------------- */

test("Kie callback: the old public default secret no longer authenticates", async () => {
  const body = JSON.stringify({ code: 200, msg: "ok", data: { callbackType: "complete", task_id: "nope" } });
  assert.equal((await kiePOST(json("http://localhost/api/webhooks/kie?secret=change-me", body))).status, 403);
  assert.equal(await outcome(() => kiePOST(json("http://localhost/api/webhooks/kie?secret=test-kie-secret", body))), "accepted", "the configured secret still works");
});

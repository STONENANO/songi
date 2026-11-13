import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../src/lib/db";
import { newProjectToken, cookieName } from "../../src/lib/session/project";
import { rateLimit, clientIp } from "../../src/lib/http/rate-limit";
import { verifyTurnstile, TURNSTILE_ACTION } from "../../src/lib/http/turnstile";
import { REWRITE_EVENT } from "../../src/lib/pipeline/spend";
import { POST as createPOST } from "../../src/app/api/requests/route";
import { POST as lyricsPOST } from "../../src/app/api/requests/[id]/lyrics/route";

type Vars = Record<string, string | undefined>;
async function withEnv<T>(vars: Vars, fn: () => Promise<T> | T): Promise<T> {
  const keep: Vars = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const put = (v: Vars) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
  put(vars);
  try {
    return await fn();
  } finally {
    put(keep);
  }
}

/** Status, or "accepted" once a handler reaches after() (which only works inside a real server). */
async function outcome(call: () => Promise<Response>): Promise<number | "accepted"> {
  try {
    return (await call()).status;
  } catch (e) {
    if (/`after` was called outside a request scope/.test((e as Error).message)) return "accepted";
    throw e;
  }
}

const SONG = { relationship: "friend", occasion: "birthday", story: "She bakes bread every Saturday morning.", genreKey: "pop" };
const create = (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
  createPOST(new Request("http://localhost/api/requests", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ ...SONG, ...extra }) }));

async function songCount(): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.songRequests);
  return n;
}

/* --------------------------------- client IP --------------------------------- */

test("client IP: the visitor-controlled first X-Forwarded-For entry is never used", async () => {
  await withEnv({ CLIENT_IP_HEADER: "", RAILWAY_ENVIRONMENT_NAME: undefined, RAILWAY_PROJECT_ID: undefined }, () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.7" } });
    assert.equal(clientIp(req), "198.51.100.7", "the entry our own proxy appended");
    assert.equal(clientIp(new Request("http://x/")), "local");
  });
});

test("client IP: on Railway the edge's X-Real-IP is used, and CLIENT_IP_HEADER can name another", async () => {
  const req = new Request("http://x/", { headers: { "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "192.0.2.4" } });
  await withEnv({ CLIENT_IP_HEADER: undefined, RAILWAY_ENVIRONMENT_NAME: "production" }, () => assert.equal(clientIp(req), "203.0.113.9"));
  await withEnv({ CLIENT_IP_HEADER: "CF-Connecting-IP", RAILWAY_ENVIRONMENT_NAME: "production" }, () => assert.equal(clientIp(req), "192.0.2.4"));
});

/* ------------------------------- database limiter ------------------------------- */

test("rate limit: counts in the database, per key, and resets after the window", async () => {
  const key = `test:${Math.random()}`;
  for (let i = 1; i <= 3; i++) assert.equal(await rateLimit(key, 3, 60_000), true, `hit ${i}`);
  assert.equal(await rateLimit(key, 3, 60_000), false, "4th hit refused");
  assert.equal(await rateLimit(`${key}:other`, 3, 60_000), true, "other keys are separate");

  // Stored hashed: neither the key nor an IP is readable in the table.
  const db = await getDb();
  const rows = await db.select().from(schema.rateLimits);
  assert.ok(rows.length > 0 && rows.every((r) => /^[0-9a-f]{64}$/.test(r.key)));

  // State lives in the database, not in memory: age the window there and the key is allowed again.
  await db.execute(sql`UPDATE rate_limits SET window_start = now() - interval '2 hours'`);
  assert.equal(await rateLimit(key, 3, 60_000), true, "new window");
});

test("song creation: rotating fake X-Forwarded-For values no longer get past the per-visitor limit (audit case)", async () => {
  await withEnv({ MAX_SONGS_PER_DAY: "0", CLIENT_IP_HEADER: "", RAILWAY_ENVIRONMENT_NAME: undefined, RAILWAY_PROJECT_ID: undefined }, async () => {
    const results: (number | "accepted")[] = [];
    // Local limit is 200 per hour; 202 attempts from one real connection, each claiming a new IP.
    for (let i = 0; i < 202; i++) results.push(await outcome(() => create({ "x-forwarded-for": `10.${i >> 8}.${i & 255}.1, 198.51.100.200` })));
    assert.equal(results.filter((r) => r === "accepted").length, 200);
    assert.deepEqual(results.slice(200), [429, 429]);
  });
});

/* ------------------------------------ Turnstile ------------------------------------ */

const TURNSTILE_ON = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-site", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret" };
type Siteverify = { success: boolean; action?: string; "error-codes"?: string[] };

/** Replace fetch for Cloudflare's siteverify; records what was sent. */
async function withSiteverify<T>(reply: Siteverify | Error, fn: (sent: URLSearchParams[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const sent: URLSearchParams[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
    sent.push(new URLSearchParams(init?.body as URLSearchParams));
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = real;
  }
}

test("Turnstile: off without keys, so local development and tests need no token", async () => {
  await withEnv({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "" }, async () => assert.deepEqual(await verifyTurnstile(undefined, "1.2.3.4"), { ok: true }));
});

test("Turnstile: the token, secret and visitor IP are sent to Cloudflare; the action must match", async () => {
  await withEnv(TURNSTILE_ON, async () => {
    await withSiteverify({ success: true, action: TURNSTILE_ACTION }, async (sent) => {
      assert.deepEqual(await verifyTurnstile("tok", "203.0.113.5"), { ok: true });
      assert.equal(sent[0].get("response"), "tok");
      assert.equal(sent[0].get("secret"), "0x4AAAAAAA-secret");
      assert.equal(sent[0].get("remoteip"), "203.0.113.5");
    });
    await withSiteverify({ success: true, action: "login" }, async () => assert.equal((await verifyTurnstile("tok", "x")).ok, false));
    await withSiteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }, async () =>
      assert.deepEqual(await verifyTurnstile("tok", "x"), { ok: false, reason: "timeout-or-duplicate" }),
    );
  });
});

test("song creation with Turnstile on: no token, a failed check or Cloudflare unreachable creates nothing", async () => {
  await withEnv({ ...TURNSTILE_ON, MAX_SONGS_PER_DAY: "0" }, async () => {
    const before = await songCount();
    const ip = { "x-forwarded-for": "198.51.100.31" };
    await withSiteverify({ success: true, action: TURNSTILE_ACTION }, async (sent) => {
      assert.equal(await outcome(() => create(ip)), 403, "no token");
      assert.equal(sent.length, 0, "a missing token never reaches Cloudflare");
    });
    await withSiteverify({ success: false, "error-codes": ["invalid-input-response"] }, async () => assert.equal(await outcome(() => create(ip, { turnstileToken: "bad" })), 403));
    await withSiteverify(new Error("network down"), async () => assert.equal(await outcome(() => create(ip, { turnstileToken: "tok" })), 403, "fails closed"));
    assert.equal(await songCount(), before, "no song was created");

    await withSiteverify({ success: true, action: TURNSTILE_ACTION }, async () => assert.equal(await outcome(() => create(ip, { turnstileToken: "good" })), "accepted"));
    assert.equal(await songCount(), before + 1);
    const db = await getDb();
    const [latest] = await db.select().from(schema.songRequests).orderBy(sql`created_at desc`).limit(1);
    assert.ok(!JSON.stringify(latest.quizSnapshot).includes("good"), "the token is not stored with the song");
  });
});

/* ------------------------------ lasting lyric caps ------------------------------ */

async function songAtLyrics() {
  const db = await getDb();
  const { token, hash } = newProjectToken();
  const [r] = await db.insert(schema.songRequests).values({ relationship: "mom", occasion: "birthday", story: "A long enough story.", genreKey: "pop", accessTokenHash: hash, status: "lyrics_ready" }).returning({ id: schema.songRequests.id });
  const regenerate = () =>
    outcome(() => lyricsPOST(new Request(`http://localhost/api/requests/${r.id}/lyrics`, { method: "POST", headers: { "Content-Type": "application/json", cookie: `${cookieName(r.id)}=${token}` }, body: JSON.stringify({ action: "regenerate" }) }), { params: Promise.resolve({ id: r.id }) }));
  return { id: r.id, regenerate };
}

async function rewrites(id: string): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.events).where(and(eq(schema.events.requestId, id), eq(schema.events.type, REWRITE_EVENT)));
  return n;
}

test("lyrics: each accepted rewrite is counted in the database", async () => {
  const s = await songAtLyrics();
  assert.equal(await s.regenerate(), "accepted");
  assert.equal(await rewrites(s.id), 1);
});

test("lyrics: past MAX_LYRIC_REWRITES the song gets no more rewrites, even after a restart (audit case)", async () => {
  await withEnv({ MAX_LYRIC_REWRITES: "3" }, async () => {
    const s = await songAtLyrics();
    const db = await getDb();
    await db.insert(schema.events).values([1, 2, 3].map(() => ({ requestId: s.id, type: REWRITE_EVENT, payload: { action: "regenerate" } })));
    assert.equal(await s.regenerate(), 429);
    assert.equal(await rewrites(s.id), 3, "a refused rewrite is not counted");
  });
});

test("lyrics: past MAX_LLM_USD_PER_SONG of estimated Claude spend, rewrites stop", async () => {
  await withEnv({ MAX_LLM_USD_PER_SONG: "2" }, async () => {
    const s = await songAtLyrics();
    const db = await getDb();
    await db.insert(schema.costLedger).values({ requestId: s.id, provider: "anthropic", operation: "lyrics", units: 1, costUsd: "2.1000" });
    assert.equal(await s.regenerate(), 429);
    // Mock (free) usage never counts toward the cap.
    const t = await songAtLyrics();
    await db.insert(schema.costLedger).values({ requestId: t.id, provider: "anthropic-mock", operation: "lyrics", units: 1, costUsd: "9.0000" });
    assert.equal(await t.regenerate(), "accepted");
  });
});

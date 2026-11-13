import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../src/lib/db";
import { runBriefing, startGeneration, pollIfGenerating, getRequestView } from "../../src/lib/pipeline/run";
import { newProjectToken, cookieName, checkAccess } from "../../src/lib/session/project";
import { issuePreviewLink, verifyPreviewLink, previewLinkFor, previewLinkCookieName } from "../../src/lib/session/preview-link";
import { normalizeEmail, sendPreviewLinkEmail, previewLinkEmail, sendPurchaseEmail, purchaseEmail } from "../../src/lib/email";
import { startCheckout, payWithTestCheckout } from "../../src/lib/commerce/orders";
import { deliveryToken } from "../../src/lib/media/tokens";
import { purgeExpiredPreviews } from "../../src/lib/pipeline/retention";
import { getStorage } from "../../src/lib/storage";
import { POST as createPOST } from "../../src/app/api/requests/route";
import { GET as songGET } from "../../src/app/api/requests/[id]/route";
import { POST as selectPOST } from "../../src/app/api/requests/[id]/select/route";

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

async function outcome(call: () => Promise<Response>): Promise<number | "accepted"> {
  try {
    return (await call()).status;
  } catch (e) {
    if (/`after` was called outside a request scope/.test((e as Error).message)) return "accepted";
    throw e;
  }
}

const HOUR = 3600_000;
const STORY = "Mom taught me to make pancakes every Sunday. She sings off-key in the car on every road trip. Her happy place is the lake house in Michigan.";

/** A song driven through the mock pipeline to real, stored versions (preview_ready). */
async function readySong(over: Partial<typeof schema.songRequests.$inferInsert> = {}) {
  const db = await getDb();
  const { token, hash } = newProjectToken();
  const [r] = await db
    .insert(schema.songRequests)
    .values({ recipientName: "Linda", relationship: "mom", occasion: "birthday", story: STORY, genreKey: "country", vocalGender: "f", mood: "heartfelt", accessTokenHash: hash, ...over })
    .returning();
  await runBriefing(r.id);
  assert.equal((await startGeneration(r.id)).ok, true);
  for (let i = 0; i < 40; i++) {
    await pollIfGenerating(r.id, { force: true });
    if ((await getRequestView(r.id))?.status === "preview_ready") break;
  }
  const [after] = await db.select().from(schema.songRequests).where(eq(schema.songRequests.id, r.id));
  assert.equal(after.status, "preview_ready");
  return { id: r.id, ownerCookie: `${cookieName(r.id)}=${token}`, row: after };
}

const get = (id: string, query = "", cookie?: string) =>
  songGET(new Request(`http://localhost/api/requests/${id}${query}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

/* ---------------------------------- emails ---------------------------------- */

test("email normalization: case, +tags and Gmail dots don't make a new address", () => {
  assert.equal(normalizeEmail("  Jane.Doe+songs@Gmail.com "), "janedoe@gmail.com");
  assert.equal(normalizeEmail("j.a.n.e.doe@googlemail.com"), "janedoe@gmail.com");
  assert.equal(normalizeEmail("jane.doe+x@outlook.com"), "jane.doe@outlook.com", "dots matter outside Gmail");
});

const create = (email: string, ip: string) =>
  outcome(() =>
    createPOST(
      new Request("http://localhost/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ relationship: "friend", occasion: "birthday", story: "She bakes bread every Saturday morning.", genreKey: "pop", email }),
      }),
    ),
  );

test("3 songs per email per week: the 4th is refused, however the address is written", async () => {
  await withEnv({ MAX_SONGS_PER_EMAIL_PER_WEEK: "3" }, async () => {
    assert.equal(await create("quota.test@gmail.com", "198.51.100.61"), "accepted");
    assert.equal(await create("Quota.Test+2@gmail.com", "198.51.100.62"), "accepted");
    assert.equal(await create("quotatest@googlemail.com", "198.51.100.63"), "accepted");
    const res = await createPOST(
      new Request("http://localhost/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.64" },
        body: JSON.stringify({ relationship: "friend", occasion: "birthday", story: "She bakes bread every Saturday morning.", genreKey: "pop", email: "q.u.o.t.a.test+4@gmail.com" }),
      }),
    );
    assert.equal(res.status, 429);
    const j = (await res.json()) as { error: string; code: string };
    assert.equal(j.code, "email_weekly_limit");
    assert.match(j.error, /in 7 days/);
    assert.equal(await create("someone.else@gmail.com", "198.51.100.65"), "accepted", "other addresses are unaffected");
  });
});

test("3 songs per email per week: songs older than 7 days don't count", async () => {
  const db = await getDb();
  const old = new Date(Date.now() - 8 * 24 * HOUR);
  await db.insert(schema.songRequests).values([1, 2, 3].map(() => ({ relationship: "friend", occasion: "birthday", story: "x".repeat(20), genreKey: "pop", email: "old@example.com", emailNormalized: "old@example.com", createdAt: old })));
  assert.equal(await create("old@example.com", "198.51.100.66"), "accepted");
});

test("in production an email is required (so the weekly limit can't be skipped by leaving it out)", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => assert.equal(await create("", "198.51.100.67"), 400));
});

test("no site-wide daily cap by default", async () => {
  await withEnv({ MAX_SONGS_PER_DAY: undefined }, async () => {
    const { env } = await import("../../src/lib/env");
    assert.equal(env.maxSongsPerDay, 0);
  });
});

/* ------------------------------- preview links ------------------------------- */

test("preview link token: valid until it expires, only for its own song, and can't be edited", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const now = Date.now();
  const t = issuePreviewLink(id, now + 48 * HOUR);
  assert.equal(verifyPreviewLink(t, id, now).status, "valid");
  assert.equal(verifyPreviewLink(t, id, now + 49 * HOUR).status, "expired");
  assert.equal(verifyPreviewLink(t, "22222222-2222-2222-2222-222222222222", now).status, "invalid");
  // Push the expiry out by rewriting the payload: the signature no longer matches.
  const [, sig] = t.split(".");
  const longer = Buffer.from(JSON.stringify({ r: id, x: Math.floor(now / 1000) + 999 * 3600 })).toString("base64url");
  assert.equal(verifyPreviewLink(`${longer}.${sig}`, id, now).status, "invalid");
});

test("preview link: opens the versions on another device for 48 hours, then expires", async () => {
  const s = await readySong();
  const link = previewLinkFor(s.row);
  assert.ok(link, "a link once versions are ready");
  const expires = new Date(link.expiresAt).getTime();
  assert.ok(Math.abs(expires - (s.row.candidatesFinalizedAt!.getTime() + 48 * HOUR)) < 1000, "48 hours after the versions were ready");
  const p = new URL(link.url).searchParams.get("p")!;

  // A new device: no cookie, only the link.
  assert.equal((await get(s.id)).status, 403, "without the link: no access");
  const res = await get(s.id, `?p=${p}`);
  assert.equal(res.status, 200);
  const view = (await res.json()) as { candidates: { id: string; previewUrl: string | null }[]; previewLink: { url: string } | null; access: string };
  assert.equal(view.access, "link");
  assert.ok(view.candidates.length > 0 && view.candidates.every((c) => c.previewUrl), "previews play");
  assert.ok(view.previewLink, "the link can be copied again from that device");
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`^${previewLinkCookieName(s.id)}=`));
  assert.match(setCookie, /HttpOnly/);
  const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)![1]);
  assert.ok(maxAge > 47 * 3600 && maxAge <= 48 * 3600, "the cookie dies with the link");

  // That device can act with the cookie alone (e.g. choose a version), like the owner.
  const linkCookie = setCookie.split(";")[0];
  const sel = await selectPOST(
    new Request(`http://localhost/api/requests/${s.id}/select`, { method: "POST", headers: { "Content-Type": "application/json", cookie: linkCookie }, body: JSON.stringify({ versionId: view.candidates[0].id }) }),
    { params: Promise.resolve({ id: s.id }) },
  );
  assert.equal(sel.status, 200);

  // After 48 hours: the link is refused with its own message; the owner's browser still works.
  const later = Date.now() + 49 * HOUR;
  assert.equal(checkAccess(new Request(`http://x/?p=${p}`), { id: s.id, accessTokenHash: s.row.accessTokenHash }, later), "link_expired");
  assert.equal(checkAccess(new Request("http://x/", { headers: { cookie: s.ownerCookie } }), { id: s.id, accessTokenHash: s.row.accessTokenHash }, later), "owner");
  const db = await getDb();
  await db.update(schema.songRequests).set({ candidatesFinalizedAt: new Date(Date.now() - 49 * HOUR) }).where(eq(schema.songRequests.id, s.id));
  const expiredLink = issuePreviewLink(s.id, Date.now() - HOUR); // what the link looks like 49 hours on
  const expiredRes = await get(s.id, `?p=${expiredLink}`);
  assert.equal(expiredRes.status, 403);
  assert.equal(((await expiredRes.json()) as { code: string }).code, "link_expired");
  const ownerView = (await (await get(s.id, "", s.ownerCookie)).json()) as { candidates: { previewUrl: string | null }[]; previewLink: unknown };
  assert.ok(ownerView.candidates.every((c) => c.previewUrl), "the owner's browser can still listen (and buy)");
  assert.equal(ownerView.previewLink, null, "no expired link is offered for copying");
});

/* --------------------------------- link email --------------------------------- */

type Sent = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
function mailer(status = 200) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    return new Response("{}", { status });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

test("link email: sent once per song through Resend when configured, with the 48-hour link", async () => {
  // Made with email off, so finalize sends nothing (tests never reach a real provider).
  const s = await readySong({ email: "buyer@example.com" });
  await withEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Cryworthy <songs@example.com>", POSTMARK_SERVER_TOKEN: undefined }, async () => {
    const m = mailer();
    assert.equal(await sendPreviewLinkEmail(s.id, m.fetchImpl), "sent");
    assert.equal(m.sent.length, 1);
    assert.equal(m.sent[0].url, "https://api.resend.com/emails");
    assert.equal(m.sent[0].headers.Authorization, "Bearer re_test");
    assert.deepEqual(m.sent[0].body.to, ["buyer@example.com"]);
    assert.match(String(m.sent[0].body.text), new RegExp(`/r/${s.id}\\?p=`));
    assert.match(String(m.sent[0].body.text), /48 hours/);
    assert.equal(await sendPreviewLinkEmail(s.id, m.fetchImpl), "already_sent", "extra takes don't send it again");
    assert.equal(m.sent.length, 1);
    const view = (await (await get(s.id, "", s.ownerCookie)).json()) as { previewLinkEmailed: boolean };
    assert.equal(view.previewLinkEmailed, true, "the page says it was emailed");
  });
});

test("link email: a provider error is reported and can be retried; Postmark works too; off without settings", async () => {
  const s = await readySong({ email: "buyer2@example.com" });
  await withEnv({ POSTMARK_SERVER_TOKEN: "pm_test", EMAIL_FROM: "songs@example.com", RESEND_API_KEY: undefined }, async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.equal(await sendPreviewLinkEmail(s.id, mailer(500).fetchImpl), "failed");
    } finally {
      console.error = quiet;
    }
    const ok = mailer();
    assert.equal(await sendPreviewLinkEmail(s.id, ok.fetchImpl), "sent", "the failed send didn't use up the one email");
    assert.equal(ok.sent[0].url, "https://api.postmarkapp.com/email");
    assert.equal(ok.sent[0].headers["X-Postmark-Server-Token"], "pm_test");
  });
  const s3 = await readySong({ email: "buyer3@example.com" });
  await withEnv({ POSTMARK_SERVER_TOKEN: undefined, RESEND_API_KEY: undefined, EMAIL_FROM: undefined }, async () => {
    assert.equal(await sendPreviewLinkEmail(s3.id, mailer().fetchImpl), "not_configured");
  });
});

test("link email: names from the story are escaped in the HTML", () => {
  const m = previewLinkEmail({ to: "a@b.c", name: `<script>x</script> "Jo"`, url: "https://x.app/r/1?p=t", hours: 48, brand: "Cryworthy" });
  assert.ok(!m.html.includes("<script>"));
  assert.match(m.html, /&lt;script&gt;/);
});

/* ------------------------------- purchase email ------------------------------- */

test("purchase email: the permanent song link, once per order, with the support address", async () => {
  const s = await readySong({ email: "payer@example.com" });
  const db = await getDb();
  const [v] = await db.select().from(schema.songVersions).where(eq(schema.songVersions.requestId, s.id)).limit(1);
  const c = await startCheckout(s.id, v.id);
  assert.ok(c.ok);
  const orderId = (c as { orderId: string }).orderId;
  // Paid with email off (tests never reach a real provider), then sent by hand.
  await payWithTestCheckout(orderId);
  await withEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Cryworthy <songs@example.com>", POSTMARK_SERVER_TOKEN: undefined, SUPPORT_EMAIL: "help@example.com" }, async () => {
    const m = mailer();
    assert.equal(await sendPurchaseEmail(orderId, m.fetchImpl), "sent");
    assert.deepEqual(m.sent[0].body.to, ["payer@example.com"]);
    assert.ok(String(m.sent[0].body.text).includes(`/d/${deliveryToken(orderId)}`));
    assert.match(String(m.sent[0].body.text), /help@example\.com/);
    assert.equal(await sendPurchaseEmail(orderId, m.fetchImpl), "already_sent");
    assert.equal(m.sent.length, 1);
  });
});

test("purchase email: names are escaped in the HTML", () => {
  const m = purchaseEmail({ to: "a@b.c", name: `<b>x</b>`, url: "https://x.app/d/t", brand: "Cryworthy", support: "" });
  assert.ok(!m.html.includes("<b>x</b>"));
});

/* --------------------------------- retention --------------------------------- */

test("retention: after 14 days, audio nobody bought is deleted; a paid version and recent songs are kept", async () => {
  const old = await readySong();
  const recent = await readySong();
  const db = await getDb();
  const storage = await getStorage();
  const versions = await db.select().from(schema.songVersions).where(eq(schema.songVersions.requestId, old.id));
  assert.ok(versions.length >= 2);
  const [paid, ...rest] = versions;
  await db.update(schema.songVersions).set({ purchaseStatus: "paid" }).where(eq(schema.songVersions.id, paid.id));
  await db.update(schema.songRequests).set({ candidatesFinalizedAt: new Date(Date.now() - 15 * 24 * HOUR) }).where(eq(schema.songRequests.id, old.id));

  const r = await purgeExpiredPreviews();
  assert.ok(r.songs >= 1);
  for (const v of rest) {
    assert.equal(await storage.exists(v.previewKey!), false, "preview deleted");
    assert.equal(await storage.exists(v.audioKey!), false, "full take deleted");
  }
  assert.equal(await storage.exists(paid.audioKey!), true, "the paid song is never deleted");
  const after = await db.select().from(schema.songVersions).where(eq(schema.songVersions.requestId, old.id));
  for (const v of after.filter((x) => x.id !== paid.id)) {
    assert.equal(v.availability, "unavailable");
    assert.equal(v.audioKey, null);
    assert.equal(v.offered, false);
  }
  const recentVersions = await db.select().from(schema.songVersions).where(eq(schema.songVersions.requestId, recent.id));
  for (const v of recentVersions) assert.equal(await storage.exists(v.audioKey!), true, "recent songs untouched");

  // The page says the previews have expired; running the job again does nothing.
  const db2 = await getDb();
  await db2.update(schema.songVersions).set({ purchaseStatus: "none" }).where(eq(schema.songVersions.id, paid.id)); // view as an unbought song
  const view = (await (await get(old.id, "", old.ownerCookie)).json()) as { previewsExpired: boolean };
  assert.equal(view.previewsExpired, true);
  const again = await purgeExpiredPreviews();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.events).where(sql`${schema.events.requestId} = ${old.id} and ${schema.events.type} = 'previews:purged'`);
  assert.equal(n, 1, `purged once (second run handled ${again.songs} other songs)`);
});

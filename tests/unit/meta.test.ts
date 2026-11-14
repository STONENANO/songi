import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb, schema } from "../../src/lib/db";
import { attributionFrom, forwardToMeta, metaEventFor, metaEventId, metaUserData, sendMetaEvent, sha256 } from "../../src/lib/analytics/meta";
import { metaEventId as browserIds } from "../../src/lib/analytics/meta-ids";

test("browser and server build the same event ids (or Meta counts events twice)", () => {
  assert.equal(metaEventId.lead("r1"), browserIds.lead("r1"));
  assert.equal(metaEventId.checkout("o1"), "checkout:o1");
  assert.equal(metaEventId.purchase("o1"), "purchase:o1");
});

test("a real payment becomes a Purchase worth the price before tax", () => {
  const e = metaEventFor("order:paid", { orderId: "o1", paymentRef: "pi_123", amountCents: 4212, taxCents: 312, currency: "usd" });
  assert.equal(e?.name, "Purchase");
  assert.equal(e?.eventId, "purchase:o1");
  assert.equal(e?.customData.value, 39);
  assert.equal(e?.customData.currency, "USD");
});

test("free test unlocks and $0 orders are never sent as purchases", () => {
  assert.equal(metaEventFor("order:paid", { orderId: "o1", paymentRef: "test_o1", amountCents: 3900, taxCents: 0 }), null);
  assert.equal(metaEventFor("order:paid", { orderId: "o1", paymentRef: "pi_1", amountCents: 0, taxCents: 0 }), null);
});

test("Stripe test-mode payments are never sent as purchases", () => {
  const keep = process.env.STRIPE_SECRET_KEY;
  const paid = { orderId: "o1", paymentRef: "cs_test_1", amountCents: 3900, taxCents: 0 };
  try {
    for (const k of ["sk_test_abc", "rk_test_abc"]) {
      process.env.STRIPE_SECRET_KEY = k;
      assert.equal(metaEventFor("order:paid", paid), null, k);
    }
    for (const k of ["sk_live_abc", "rk_live_abc"]) {
      process.env.STRIPE_SECRET_KEY = k;
      assert.equal(metaEventFor("order:paid", paid)?.name, "Purchase", k);
    }
  } finally {
    process.env.STRIPE_SECRET_KEY = keep ?? "";
  }
});

test("checkout start becomes InitiateCheckout; other events are not sent", () => {
  assert.equal(metaEventFor("checkout:started", { orderId: "o2" })?.name, "InitiateCheckout");
  assert.equal(metaEventFor("checkout:started", { orderId: "o2" })?.eventId, "checkout:o2");
  for (const t of ["checkout:reused", "order:refunded", "status:preview_ready", "quiz:step_view"]) assert.equal(metaEventFor(t, { orderId: "o3" }), null, t);
});

test("user data: email normalised then SHA-256, browser IDs passed as they are", () => {
  const u = metaUserData({ email: "  Buyer@Example.COM ", externalId: "req-1", attribution: { fbp: "fb.1.1700000000000.123", fbc: "fb.1.1700000000000.AbC", ip: "203.0.113.9", ua: "UA" } });
  assert.deepEqual(u.em, [sha256("buyer@example.com")]);
  assert.match((u.em as string[])[0], /^[0-9a-f]{64}$/);
  assert.deepEqual(u.external_id, [sha256("req-1")]);
  assert.equal(u.fbp, "fb.1.1700000000000.123");
  assert.equal(u.fbc, "fb.1.1700000000000.AbC");
  assert.equal(u.client_ip_address, "203.0.113.9");
  assert.equal(u.client_user_agent, "UA");
  assert.deepEqual(metaUserData({}), {}, "nothing invented when nothing is known");
});

test("attribution: reads Meta's cookies, ignores malformed ones and the local IP placeholder", () => {
  const req = new Request("https://x/api/requests", {
    headers: { cookie: "a=1; _fbp=fb.1.1700000000000.987654; _fbc=fb.1.1700000000000.IwAR_x-1; other=2", "user-agent": "Mozilla/5.0" },
  });
  assert.deepEqual(attributionFrom(req, "198.51.100.4"), { fbp: "fb.1.1700000000000.987654", fbc: "fb.1.1700000000000.IwAR_x-1", ip: "198.51.100.4", ua: "Mozilla/5.0" });
  const bad = new Request("https://x/", { headers: { cookie: "_fbp=<script>; _fbc=" } });
  assert.equal(attributionFrom(bad, "local"), null);
});

test("sends one event to the pixel with hashed email, browser IDs and the shared event id", async () => {
  const db = await getDb();
  const [r] = await db
    .insert(schema.songRequests)
    .values({ relationship: "mom", occasion: "birthday", story: "a story long enough", genreKey: "pop", email: "Buyer@Example.com", adAttribution: { fbp: "fb.1.1.2", ip: "203.0.113.9", ua: "UA" } })
    .returning();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;
  const keep = { id: process.env.META_PIXEL_ID, token: process.env.META_CAPI_TOKEN, code: process.env.META_TEST_EVENT_CODE };
  try {
    // Off without a token: nothing sent.
    process.env.META_PIXEL_ID = "1160633139881033";
    process.env.META_CAPI_TOKEN = "";
    await sendMetaEvent(r.id, { name: "Lead", eventId: metaEventId.lead(r.id) });
    assert.equal(calls.length, 0);

    process.env.META_CAPI_TOKEN = "token_x";
    process.env.META_TEST_EVENT_CODE = "TEST123";
    await forwardToMeta(r.id, "order:paid", { orderId: "o9", paymentRef: "cs_1", amountCents: 3900, taxCents: 0, currency: "usd" });
    await forwardToMeta(r.id, "order:paid", { orderId: "o9", paymentRef: "test_o9", amountCents: 3900, taxCents: 0 }); // test unlock: not sent
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://graph.facebook.com/v23.0/1160633139881033/events");
    const body = calls[0].body as { data: Record<string, unknown>[]; access_token: string; test_event_code: string };
    assert.equal(body.access_token, "token_x");
    assert.equal(body.test_event_code, "TEST123");
    const ev = body.data[0];
    assert.equal(ev.event_name, "Purchase");
    assert.equal(ev.event_id, "purchase:o9");
    assert.equal(ev.action_source, "website");
    const ud = ev.user_data as Record<string, unknown>;
    assert.deepEqual(ud.em, [sha256("buyer@example.com")]);
    assert.equal(ud.fbp, "fb.1.1.2");
    assert.equal(ud.client_ip_address, "203.0.113.9");
    assert.deepEqual(ev.custom_data, { value: 39, currency: "USD", content_type: "product", content_ids: ["song"], num_items: 1 });
    assert.ok(!JSON.stringify(body).includes("Buyer@Example.com") && !JSON.stringify(body).toLowerCase().includes("buyer@example.com"), "the plain email never leaves");

    // Meta errors are logged, never thrown.
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Invalid token" } }), { status: 400 })) as unknown as typeof fetch;
    await assert.doesNotReject(sendMetaEvent(r.id, { name: "Lead", eventId: "lead:x" }));
  } finally {
    globalThis.fetch = realFetch;
    process.env.META_PIXEL_ID = keep.id ?? "";
    process.env.META_CAPI_TOKEN = keep.token ?? "";
    process.env.META_TEST_EVENT_CODE = keep.code ?? "";
  }
});

import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBodyText, readJson, BODY_LIMITS } from "../../src/lib/http/body";
import { productionConfigProblems, assertSafeForProduction, env } from "../../src/lib/env";
import { securityHeaders, contentSecurityPolicy } from "../../src/lib/http/security-headers";
import { verifyLegacySecret } from "../../src/lib/kie/client";

type Vars = Record<string, string | undefined>;
/** Run fn with these environment variables, then put every one back. */
function withEnv<T>(vars: Vars, fn: () => T): T {
  const keep: Vars = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const put = (v: Vars) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
  put(vars);
  try {
    return fn();
  } finally {
    put(keep);
  }
}

/** A complete production configuration with real Kie calls and live Stripe. */
const GOOD_PROD: Vars = {
  NODE_ENV: "production",
  MEDIA_SIGNING_SECRET: "a".repeat(64),
  KIE_WEBHOOK_SECRET: "b".repeat(48),
  KIE_API_KEY: "kie_live_x",
  MOCK_KIE: "",
  KIE_WEBHOOK_HMAC_KEY: "hmac_x",
  STRIPE_ENABLED: "true",
  MOCK_PAYMENTS: "",
  STRIPE_SECRET_KEY: "rk_live_x",
  STRIPE_PUBLISHABLE_KEY: "pk_live_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "songs",
  S3_ENDPOINT: "https://r2.example",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret-key",
};

/* --------------------------- production startup check --------------------------- */

test("production config: a complete configuration passes", () => {
  withEnv(GOOD_PROD, () => {
    assert.deepEqual(productionConfigProblems(), []);
    assert.doesNotThrow(() => assertSafeForProduction());
  });
});

test("production config: outside production nothing is required", () => {
  withEnv({ NODE_ENV: "test", MEDIA_SIGNING_SECRET: "", KIE_WEBHOOK_SECRET: "" }, () => {
    assert.deepEqual(productionConfigProblems(), []);
    assert.equal(env.kieWebhookSecret, "dev-only-kie-secret", "a fixed local value, so dev callbacks still verify");
  });
});

test("production config: each missing or placeholder secret is refused by name", () => {
  const cases: [Vars, RegExp][] = [
    [{ MEDIA_SIGNING_SECRET: "" }, /MEDIA_SIGNING_SECRET/],
    [{ MEDIA_SIGNING_SECRET: "dev-only-media-secret" }, /MEDIA_SIGNING_SECRET/],
    [{ KIE_WEBHOOK_SECRET: undefined }, /KIE_WEBHOOK_SECRET/],
    [{ KIE_WEBHOOK_SECRET: "change-me" }, /KIE_WEBHOOK_SECRET/],
    [{ KIE_WEBHOOK_HMAC_KEY: "" }, /KIE_WEBHOOK_HMAC_KEY/],
    [{ STRIPE_WEBHOOK_SECRET: "" }, /STRIPE_WEBHOOK_SECRET/],
    [{ STRIPE_SECRET_KEY: "" }, /STRIPE_SECRET_KEY/],
    [{ S3_SECRET_ACCESS_KEY: "" }, /S3_SECRET_ACCESS_KEY/],
  ];
  for (const [change, want] of cases) {
    withEnv({ ...GOOD_PROD, ...change }, () => {
      const problems = productionConfigProblems();
      assert.equal(problems.length, 1, `${JSON.stringify(change)} -> ${problems.join(" | ")}`);
      assert.match(problems[0], want);
      assert.throws(() => assertSafeForProduction(), /Refusing to start/);
    });
  }
});

test("production config: the problem list names settings, never their values", () => {
  withEnv({ ...GOOD_PROD, KIE_WEBHOOK_SECRET: "change-me", STRIPE_WEBHOOK_SECRET: "" }, () => {
    const text = productionConfigProblems().join("\n");
    for (const v of [GOOD_PROD.MEDIA_SIGNING_SECRET!, GOOD_PROD.STRIPE_SECRET_KEY!, GOOD_PROD.S3_SECRET_ACCESS_KEY!]) assert.ok(!text.includes(v));
  });
});

test("production config: the HMAC key is only required with real Kie calls; Stripe keys only with Stripe on", () => {
  withEnv({ ...GOOD_PROD, KIE_API_KEY: "", KIE_WEBHOOK_HMAC_KEY: "", STRIPE_ENABLED: "false", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" }, () => {
    assert.deepEqual(productionConfigProblems(), []);
  });
});

test("production: signing with the Kie secret throws instead of using a default", () => {
  withEnv({ NODE_ENV: "production", KIE_WEBHOOK_SECRET: "" }, () => assert.throws(() => env.kieWebhookSecret, /KIE_WEBHOOK_SECRET/));
  withEnv({ NODE_ENV: "production", KIE_WEBHOOK_SECRET: "change-me" }, () => assert.throws(() => env.kieWebhookSecret, /KIE_WEBHOOK_SECRET/));
});

test("legacy Kie ?secret= only matches the configured secret, never the old default", () => {
  assert.equal(verifyLegacySecret("test-kie-secret"), true);
  assert.equal(verifyLegacySecret("change-me"), false);
  assert.equal(verifyLegacySecret(""), false);
  assert.equal(verifyLegacySecret(null), false);
});

/* --------------------------------- body limits --------------------------------- */

const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

test("body limit: a body within the cap is read in full", async () => {
  assert.equal(await readBodyText(post("hello"), 10), "hello");
  const r = await readJson(post(JSON.stringify({ a: 1 })), 100);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.data, { a: 1 });
});

test("body limit: a declared Content-Length over the cap is refused before reading", async () => {
  assert.equal(await readBodyText(post("x".repeat(5), { "content-length": "999999" }), 100), null);
});

test("body limit: a streamed body with no Content-Length stops at the cap", async () => {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      if (pulled > 1000) return c.close();
      c.enqueue(new Uint8Array(1024));
    },
  });
  assert.equal(await readBodyText(post(stream), 4096), null);
  assert.ok(pulled < 20, `stopped reading early (pulled ${pulled} chunks)`);
});

test("body limit: oversized JSON gets a 413; invalid JSON gives null data", async () => {
  const big = await readJson(post("x".repeat(BODY_LIMITS.small + 1)), BODY_LIMITS.small);
  assert.ok(!big.ok);
  assert.equal(!big.ok && big.response.status, 413);
  const bad = await readJson(post("{not json"), 100);
  assert.ok(bad.ok);
  assert.equal(bad.ok && bad.data, null);
});

/* ------------------------------- security headers ------------------------------- */

test("security headers: framing is blocked and the basics are set", () => {
  const h = Object.fromEntries(securityHeaders({ dev: false }).map((x) => [x.key, x.value]));
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(h["Strict-Transport-Security"], /max-age=\d+/);
  assert.ok(!/payment=\(\)/.test(h["Permissions-Policy"]), "wallets must stay allowed");
});

test("security headers: the resource policy allows Stripe and fonts, eval only in dev, and the wait video's host", () => {
  const prod = contentSecurityPolicy({ dev: false, waitVideoUrl: "https://cdn.example.com/wait.mp4" });
  assert.match(prod, /script-src [^;]*https:\/\/js\.stripe\.com/);
  assert.match(prod, /frame-src [^;]*https:\/\/js\.stripe\.com/);
  assert.match(prod, /connect-src [^;]*https:\/\/api\.stripe\.com/);
  assert.match(prod, /style-src [^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(prod, /media-src [^;]*https:\/\/cdn\.example\.com/);
  assert.ok(!prod.includes("'unsafe-eval'"));
  assert.ok(contentSecurityPolicy({ dev: true }).includes("'unsafe-eval'"));
});

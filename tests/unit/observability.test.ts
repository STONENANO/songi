import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent, scrubUrl, sentryOptions } from "../../src/lib/observability-scrub";
import { reportError, reportIssue } from "../../src/lib/observability";
import { productionConfigProblems } from "../../src/lib/env";
import { contentSecurityPolicy } from "../../src/lib/http/security-headers";

test("scrub: delivery links, media tokens and query strings never leave the process", () => {
  assert.equal(scrubUrl("https://x.app/d/0b5e.abc123?new=1"), "https://x.app/d/[token]");
  assert.equal(scrubUrl("/api/media/eyJrIjoi.sig"), "/api/media/[token]");
  assert.equal(scrubUrl("https://x.app/admin?token=s3cret"), "https://x.app/admin");
  assert.equal(scrubUrl("/r/abc?k=claimtoken"), "/r/abc");
  assert.equal(scrubUrl("GET /d/tok failed"), "GET /d/[token] failed");
});

test("scrub: request bodies, cookies, auth headers and user data are removed from an event", () => {
  const event = {
    type: undefined,
    transaction: "/d/secret-token",
    request: {
      url: "https://x.app/r/1?k=claim",
      data: { story: "Her name is Linda and she…", email: "a@b.c" },
      cookies: { sp_123: "token" },
      query_string: "k=claim",
      headers: { cookie: "sp_123=token", "stripe-signature": "t=1", "x-real-ip": "203.0.113.1", "user-agent": "Mozilla" },
    },
    user: { email: "a@b.c", ip_address: "203.0.113.1" },
    breadcrumbs: [{ category: "fetch", data: { url: "/api/media/tok.sig?x=1" } }, { category: "navigation", data: { from: "/create", to: "/d/tok" } }],
    exception: { values: [{ type: "Error", value: "Download failed for /api/media/tok.sig" }] },
  } as unknown as ErrorEvent;
  const out = scrubEvent(event);
  const text = JSON.stringify(out);
  for (const secret of ["Linda", "a@b.c", "claim", "secret-token", "tok.sig", "sp_123", "203.0.113.1", "t=1"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.equal(out.request?.headers?.["user-agent"], "Mozilla", "harmless headers stay");
});

test("Sentry is off without a DSN, errors-only with one, and never sends default PII", () => {
  assert.equal(sentryOptions(undefined, "test").enabled, false);
  const on = sentryOptions("https://k@o1.ingest.us.sentry.io/2", "production");
  assert.equal(on.enabled, true);
  assert.equal(on.sendDefaultPii, false);
  assert.ok(!("tracesSampleRate" in on), "tracing fully off (unset), not on at 0%");
});

test("reporting works with Sentry off (logs only, never throws)", () => {
  const orig = { error: console.error, warn: console.warn };
  const lines: string[] = [];
  console.error = console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    reportError(new Error("boom"), { where: "test" });
    reportIssue("Paid order could not be delivered", { kind: "paid_unfulfilled", orderId: "o1" }, "fatal");
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(lines.some((l) => l.includes("boom")));
  assert.ok(lines.some((l) => l.includes("Paid order could not be delivered")));
});

test("production config: half a Turnstile setup is refused", () => {
  const keep = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", MEDIA_SIGNING_SECRET: "m".repeat(40), KIE_WEBHOOK_SECRET: "k".repeat(40), NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "" });
    assert.ok(productionConfigProblems().some((p) => /Turnstile/.test(p)));
    process.env.TURNSTILE_SECRET_KEY = "secret";
    assert.ok(!productionConfigProblems().some((p) => /Turnstile/.test(p)));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

test("content policy (report-only) allows Turnstile and the Sentry ingest host, not the DSN key", () => {
  const csp = contentSecurityPolicy({ dev: false, sentryDsn: "https://publickey@o9.ingest.us.sentry.io/77" });
  assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/o9\.ingest\.us\.sentry\.io/);
  assert.ok(!csp.includes("publickey"));
});

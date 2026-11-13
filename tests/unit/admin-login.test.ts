import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdminEmail } from "../../src/lib/auth/admin-session";
import { env, productionConfigProblems } from "../../src/lib/env";

type Vars = Record<string, string | undefined>;
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

test("only listed emails get in, ignoring case and spaces", () => {
  const allowed = ["owner@example.com", "partner@example.com"];
  assert.equal(isAdminEmail("owner@example.com", allowed), true);
  assert.equal(isAdminEmail(" Owner@Example.COM ", allowed), true);
  assert.equal(isAdminEmail("stranger@example.com", allowed), false);
  assert.equal(isAdminEmail("owner@example.com.evil.com", allowed), false);
  assert.equal(isAdminEmail("", allowed), false);
  assert.equal(isAdminEmail(null, allowed), false);
  assert.equal(isAdminEmail("owner@example.com", []), false, "an empty list lets nobody in");
});

test("ADMIN_EMAILS is read as a lower-cased, comma-separated list", () => {
  withEnv({ ADMIN_EMAILS: " Owner@Example.com , partner@example.com,," }, () => {
    assert.deepEqual(env.adminEmails, ["owner@example.com", "partner@example.com"]);
  });
});

test("sign-in counts as configured only with the project URL and key", () => {
  withEnv({ SUPABASE_URL: "https://ref.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_ANON_KEY: "" }, () => assert.equal(env.adminLoginConfigured, false));
  withEnv({ SUPABASE_URL: "https://ref.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }, () => {
    assert.equal(env.adminLoginConfigured, true);
    assert.equal(env.supabaseUrl, "https://ref.supabase.co");
  });
  withEnv({ SUPABASE_URL: "https://ref.supabase.co", SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_ANON_KEY: "legacy_anon" }, () => assert.equal(env.adminLoginConfigured, true));
});

test("production refuses a half-configured admin sign-in, allows all or none", () => {
  const base = { NODE_ENV: "production", MEDIA_SIGNING_SECRET: "a".repeat(64), KIE_WEBHOOK_SECRET: "b".repeat(48), KIE_API_KEY: "", MOCK_KIE: "1", STORAGE_DRIVER: "local" };
  const none = { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_ANON_KEY: "", ADMIN_EMAILS: "" };
  const all = { SUPABASE_URL: "https://ref.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_ANON_KEY: "", ADMIN_EMAILS: "owner@example.com" };
  const signIn = (p: string[]) => p.filter((x) => x.includes("/admin sign-in"));
  withEnv({ ...base, ...none }, () => assert.deepEqual(signIn(productionConfigProblems()), []));
  withEnv({ ...base, ...all }, () => assert.deepEqual(signIn(productionConfigProblems()), []));
  withEnv({ ...base, ...all, ADMIN_EMAILS: "" }, () => assert.equal(signIn(productionConfigProblems()).length, 1, "no allowed emails"));
  withEnv({ ...base, ...none, ADMIN_EMAILS: "owner@example.com" }, () => assert.equal(signIn(productionConfigProblems()).length, 1, "emails but no project"));
  withEnv({ ...base, ...all, SUPABASE_PUBLISHABLE_KEY: "" }, () => assert.equal(signIn(productionConfigProblems()).length, 1, "no key"));
});

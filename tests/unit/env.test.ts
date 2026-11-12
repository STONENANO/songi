import "../setup";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assertSafeForProduction, productionConfigProblems } from "../../src/lib/env";

/** A production config that passes every check; each test breaks one thing. */
const SAFE: Record<string, string> = {
  NODE_ENV: "production",
  KIE_WEBHOOK_SECRET: "a-real-kie-secret",
  MEDIA_SIGNING_SECRET: "a-real-media-secret",
  STORAGE_DRIVER: "local",
  SHOPIFY_STORE_DOMAIN: "",
  SHOPIFY_STOREFRONT_TOKEN: "",
  SHOPIFY_SONG_VARIANT_ID: "",
  SHOPIFY_WEBHOOK_SECRET: "",
  MOCK_SHOPIFY: "",
  S3_BUCKET: "",
  S3_ACCESS_KEY_ID: "",
  S3_SECRET_ACCESS_KEY: "",
};
const saved = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries({ ...SAFE, ...overrides })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

function expectProblem(pattern: RegExp): void {
  const problems = productionConfigProblems();
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], pattern);
  assert.throws(() => assertSafeForProduction(), pattern);
}

test("production config: a safe config passes", () => {
  withEnv({});
  assert.deepEqual(productionConfigProblems(), []);
  assert.doesNotThrow(() => assertSafeForProduction());
});

test("production config: nothing is checked outside production", () => {
  withEnv({ NODE_ENV: "development", KIE_WEBHOOK_SECRET: undefined, MEDIA_SIGNING_SECRET: undefined });
  assert.deepEqual(productionConfigProblems(), []);
  assert.doesNotThrow(() => assertSafeForProduction());
});

test("production config: KIE_WEBHOOK_SECRET left at change-me, unset or empty", () => {
  for (const v of ["change-me", undefined, ""]) {
    withEnv({ KIE_WEBHOOK_SECRET: v });
    expectProblem(/KIE_WEBHOOK_SECRET/);
  }
});

test("production config: real Shopify without SHOPIFY_WEBHOOK_SECRET", () => {
  const shopify = { SHOPIFY_STORE_DOMAIN: "shop.myshopify.com", SHOPIFY_STOREFRONT_TOKEN: "tok", SHOPIFY_SONG_VARIANT_ID: "gid://shopify/ProductVariant/1" };
  withEnv(shopify);
  expectProblem(/SHOPIFY_WEBHOOK_SECRET/);
  withEnv({ ...shopify, SHOPIFY_WEBHOOK_SECRET: "whsec" });
  assert.deepEqual(productionConfigProblems(), []);
});

test("production config: STORAGE_DRIVER=s3 without bucket settings", () => {
  withEnv({ STORAGE_DRIVER: "s3" });
  expectProblem(/S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are not set/);
  withEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k" });
  expectProblem(/S3_SECRET_ACCESS_KEY is not set/);
  withEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" });
  assert.deepEqual(productionConfigProblems(), []);
});

test("production config: MEDIA_SIGNING_SECRET is read and required", () => {
  withEnv({ MEDIA_SIGNING_SECRET: undefined });
  expectProblem(/MEDIA_SIGNING_SECRET/);
});

test("production config: every problem is reported at once", () => {
  withEnv({ KIE_WEBHOOK_SECRET: undefined, MEDIA_SIGNING_SECRET: undefined, STORAGE_DRIVER: "s3" });
  assert.equal(productionConfigProblems().length, 3);
});

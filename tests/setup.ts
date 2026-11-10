/**
 * Test environment: in-memory database, temp storage, every provider mocked,
 * zero network and zero spend. Import this FIRST in every test file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const storage = fs.mkdtempSync(path.join(os.tmpdir(), "songcraft-test-"));
Object.assign(process.env, {
  PGLITE_DATA_DIR: "memory://",
  STORAGE_LOCAL_DIR: storage,
  DATABASE_URL: "",
  ANTHROPIC_API_KEY: "",
  KIE_API_KEY: "",
  SHOPIFY_STORE_DOMAIN: "",
  MOCK_LLM: "1",
  MOCK_KIE: "1",
  MOCK_SHOPIFY: "1",
  MOCK_KIE_DELAY_MS: "0",
  RANDOMIZE_CANDIDATE_ORDER: "false",
  MEDIA_SIGNING_SECRET: "test-media-secret",
  KIE_WEBHOOK_SECRET: "test-kie-secret",
  APP_URL: "http://localhost:4747",
  NODE_ENV: "test",
});

export const TEST_STORAGE_DIR = storage;

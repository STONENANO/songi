import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleNotice } from "../../src/lib/db";

function captured(fn: () => void): { log: string[]; warn: string[] } {
  const out = { log: [] as string[], warn: [] as string[] };
  const { log, warn } = console;
  console.log = (...a: unknown[]) => void out.log.push(a.join(" "));
  console.warn = (...a: unknown[]) => void out.warn.push(a.join(" "));
  try {
    fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return out;
}

test("Postgres NOTICEs from idempotent migrations print nothing; WARNINGs print one line", () => {
  const out = captured(() => {
    handleNotice({
      severity_local: "NOTICE",
      severity: "NOTICE",
      code: "42701",
      message: 'column "variant_id" of relation "song_versions" already exists, skipping',
    });
    handleNotice({ severity: "WARNING", code: "01000", message: "something to look at" });
  });
  assert.deepEqual(out.log, []);
  assert.deepEqual(out.warn, ["[db] Postgres warning 01000: something to look at"]);
});

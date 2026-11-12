import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseOf } from "../../src/app/r/[id]/use-song";
import type { RequestView } from "../../src/lib/pipeline/view";

const view = (status: RequestView["status"], candidates: number) => ({ status, candidates: Array.from({ length: candidates }, (_, i) => ({ id: `v${i}` })) }) as unknown as RequestView;

test("a song that is ready but has nothing offered yet keeps waiting instead of showing the error screen", () => {
  assert.equal(phaseOf(view("preview_ready", 0), null), "recording");
  assert.equal(phaseOf(view("preview_ready", 3), null), "versions");
  assert.equal(phaseOf(view("failed", 0), null), "failed");
});

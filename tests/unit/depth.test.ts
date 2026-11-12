import { test } from "node:test";
import assert from "node:assert/strict";
import { boostersFor, isThin, storyDepth } from "../../src/lib/onboarding/depth";

const base = { oneLine: "", anythingElse: "", boosters: {} as Record<string, string> };

test("one topic retold three ways is still thin", () => {
  // The case that used to trigger questions after the email: a single saying.
  const i = { ...base, threads: ["sayings"], topics: { sayings: { blanks: ["we got this", "I can do anything", "things get hard"] } } };
  assert.equal(storyDepth(i).sources, 1);
  assert.equal(isThin(i), true);
});

test("two answered topics plus a line is enough", () => {
  const i = {
    ...base,
    oneLine: "You are my rock",
    threads: ["sayings", "how_met"],
    topics: { sayings: { blanks: ["we got this", "I can do anything"] }, how_met: { choice: "At work", detail: "she spilled coffee on my desk" } },
  };
  assert.equal(isThin(i), false);
});

test("filling the starters makes a thin story full", () => {
  const thin = { ...base, threads: ["sayings"], topics: { sayings: { blanks: ["we got this", "anything", "hard times"] } } };
  const filled = { ...thin, boosters: { moment: "the night the car broke down in Ohio", place: "the lake house in Michigan" } };
  assert.equal(isThin(thin), true);
  assert.equal(isThin(filled), false);
});

test("starters skip kinds of detail already given", () => {
  const keys = boostersFor(["sayings", "how_met"]).map((b) => b.key);
  assert.equal(keys.length, 2);
  assert.ok(!keys.includes("only_them") && !keys.includes("moment"));
});

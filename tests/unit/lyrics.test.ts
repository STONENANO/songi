import "../setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeLyrics, getGenre, draftIsSingable, type Lyrics } from "../../src/lib/songcraft";
import { songcraftHooks, resetMockCounters } from "../../src/lib/songcraft/mock";
import { withUsage } from "../../src/lib/llm/client";
import { brief, goodLyrics, report } from "../fixtures";

const country = getGenre("country");

beforeEach(() => {
  delete songcraftHooks.writer;
  delete songcraftHooks.verifier;
  resetMockCounters();
});

test("baseline: one writer call and one verifier call when the first draft passes", async () => {
  songcraftHooks.writer = () => goodLyrics();
  songcraftHooks.verifier = () => report();
  const { result, usage } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: "heartfelt", maxRepairs: 1, craftRepairBelow: 0 }));
  assert.equal(result.chosen.status, "verified");
  assert.deepEqual(usage.map((u) => u.operation), ["lyrics_write", "verify"]);
});

test("a critical failure triggers a localized repair that preserves untouched sections", async () => {
  const bad = goodLyrics();
  bad.sections[0] = { tag: "Verse 1", lines: ["We flew to Paris in a hot balloon", "You taught me pancakes with a steady hand", "The kitchen warm before the sun", "I still make them like you've done"] };
  songcraftHooks.writer = ({ kind, previous }) => {
    if (kind === "write") return bad;
    // The repair rewrites Verse 1 but also (wrongly) tampers with Verse 2.
    const r = structuredClone(previous!);
    r.sections[0].lines[0] = "Sunday morning, batter in the pan";
    r.sections[2].lines[0] = "TAMPERED LINE";
    return r;
  };
  songcraftHooks.verifier = ({ lyrics }) =>
    lyrics.sections[0].lines[0].includes("Paris") ? report({ pass: false, inventedDetails: [{ section: "Verse 1", line: "We flew to Paris in a hot balloon", claim: "Paris trip" }] }, { sectionsToRepair: ["Verse 1"] }) : report();
  const { result } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: null, maxRepairs: 1, craftRepairBelow: 0 }));
  assert.equal(result.chosen.status, "verified");
  assert.equal(result.chosen.lyrics.sections[2].lines[0], "Up at the lake house in Michigan", "untouched section restored");
  assert.ok(result.chosen.notes.some((n) => n.includes("Restored")));
  assert.equal(result.attempts.length, 2);
});

test("a repair that makes things worse never replaces a valid draft", async () => {
  // First draft valid but weak; the craft repair invents a detail.
  songcraftHooks.writer = ({ kind }) => (kind === "write" ? goodLyrics() : goodLyrics({ sections: goodLyrics().sections.map((s, i) => (i === 4 ? { tag: "Bridge", lines: ["Remember Rome in ninety-two", "The gondola built just for you"] } : s)) }));
  let call = 0;
  songcraftHooks.verifier = () => {
    call++;
    const s = (n: number) => ({ score: n, why: "" });
    return call === 1
      ? report({}, { scores: { emotionalImpact: s(3), personalSpecificity: s(3), hookMemorability: s(3), singability: s(3), genreFit: s(3) } })
      : report({ pass: false, inventedDetails: [{ section: "Bridge", line: "Remember Rome in ninety-two", claim: "Rome" }] });
  };
  const { result } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: null, maxRepairs: 1, craftRepairBelow: 5 }));
  assert.equal(result.attempts.length, 2);
  assert.equal(result.chosen.status, "verified");
  assert.equal(result.chosen.lyrics.sections[4].lines[0], "So here's my thank you, plain and true");
});

test("drafts that stay invalid after the repair budget are marked failed, never verified", async () => {
  songcraftHooks.writer = () => goodLyrics({ sections: goodLyrics().sections.map((s) => (s.tag === "Chorus" ? { ...s, lines: ["No name here", "None at all", "Still none", "Nope"] } : s)) });
  songcraftHooks.verifier = () => report();
  const { result } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: null, maxRepairs: 1, craftRepairBelow: 0 }));
  assert.equal(result.chosen.status, "failed");
  assert.ok(result.chosen.issues.some((i) => i.code === "name_missing_chorus"));
});

test("over-limit drafts get one shortening pass (no verifier spent on the broken draft)", async () => {
  const huge: Lyrics = goodLyrics();
  huge.sections[0] = { tag: "Verse 1", lines: Array.from({ length: 6 }, () => "word ".repeat(180).trim()) };
  songcraftHooks.writer = ({ kind }) => (kind === "write" ? huge : goodLyrics());
  songcraftHooks.verifier = () => report();
  const { result, usage } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: null, maxRepairs: 1, craftRepairBelow: 0 }));
  assert.deepEqual(usage.map((u) => u.operation), ["lyrics_write", "lyrics_shorten", "verify"]);
  assert.equal(result.chosen.source, "shorten");
  assert.equal(result.chosen.status, "verified");
});

test("legacy drafts are gated by their stored v1 verdict", () => {
  assert.equal(draftIsSingable({ status: null, verifierReport: { pass: true } }), true);
  assert.equal(draftIsSingable({ status: null, verifierReport: { pass: false } }), false);
  assert.equal(draftIsSingable({ status: "failed", verifierReport: { pass: true } }), false);
  assert.equal(draftIsSingable({ status: "verified", verifierReport: null }), true);
});

test("a good overall score with poor singability still gets one polish pass", async () => {
  songcraftHooks.writer = () => goodLyrics();
  let call = 0;
  songcraftHooks.verifier = () => {
    call++;
    const s = (n: number) => ({ score: n, why: "" });
    return call === 1
      ? report({}, { scores: { emotionalImpact: s(8), personalSpecificity: s(8), hookMemorability: s(8), singability: s(5), genreFit: s(8) } })
      : report();
  };
  const { result } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: null, maxRepairs: 1, craftRepairBelow: 5, polishSingabilityBelow: 7 }));
  assert.equal(result.attempts.length, 2);
  assert.equal(result.chosen.status, "verified");
});

test("craftRepairBelow 0 disables the singability polish too", async () => {
  songcraftHooks.writer = () => goodLyrics();
  const s = (n: number) => ({ score: n, why: "" });
  songcraftHooks.verifier = () => report({}, { scores: { emotionalImpact: s(8), personalSpecificity: s(8), hookMemorability: s(8), singability: s(4), genreFit: s(8) } });
  const { result } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: null, maxRepairs: 1, craftRepairBelow: 0, polishSingabilityBelow: 7 }));
  assert.equal(result.attempts.length, 1);
});

test("writer v3 drafts map onto the shared contract and keep their plan", async () => {
  const { fromV3Lyrics } = await import("../../src/lib/songcraft/types");
  const base = goodLyrics();
  const v3 = {
    ...base,
    plan: {
      thesis: "Her joy taught me mine.",
      shape: "joke_to_truth" as const,
      hookOptions: [
        { kind: "their_words" as const, line: "You never cared who heard", verdict: "Hers, but flat." },
        { kind: "parallel_phrase" as const, line: "From the stove to the open road", verdict: "Compresses it." },
        { kind: "image" as const, line: "The song in the car", verdict: "Sings well." },
      ],
      hookConcept: "Linda, you're the song in the car",
      centralDetail: "fact_02",
      boxes: [
        { section: "Verse 1", idea: "Sunday pancakes", factIds: ["fact_01"] },
        { section: "Verse 2", idea: "Off-key at the lake", factIds: ["fact_02"] },
      ],
      reframe: "The last chorus becomes a thank-you.",
      payoff: "Seen.",
      ending: "Echo the hook.",
    },
  };
  const l = fromV3Lyrics(v3);
  assert.deepEqual(l.plan.verseRoles, ["Verse 1: Sunday pancakes [fact_01]", "Verse 2: Off-key at the lake [fact_02]"]);
  assert.equal((l.plan as Record<string, unknown>).shape, "joke_to_truth");
  songcraftHooks.writer = () => goodLyrics();
  songcraftHooks.verifier = () => report();
  const { result } = await withUsage(() => writeLyrics({ brief: brief(), genre: country, mood: null, writerVersion: "v3", maxRepairs: 1, craftRepairBelow: 0 }));
  assert.match(result.chosen.promptVersion, /\/v3$/);
});

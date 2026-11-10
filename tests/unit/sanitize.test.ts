import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spellOutNumbers, numberToWords, stripArtistReferences, fitTitle, toSungLyrics, renderLyrics, validateLyrics, ARRANGEMENTS } from "../../src/lib/songcraft";
import { brief, goodLyrics } from "../fixtures";

test("numbers, years and ordinals are spelled for singing", () => {
  assert.equal(spellOutNumbers("turning 60").text, "turning sixty");
  assert.equal(spellOutNumbers("since 1985").text, "since nineteen eighty-five");
  assert.equal(spellOutNumbers("in 2007").text, "in two thousand seven");
  assert.equal(spellOutNumbers("our 7th grade fair").text, "our seventh grade fair");
  assert.equal(spellOutNumbers("the 22nd").text, "the twenty-second");
  assert.equal(numberToWords(130), "one hundred and thirty");
  assert.deepEqual(spellOutNumbers("call 555123").unconverted, ["555123"]);
});

test("artist references are removed with their lead-in, legitimate requests stay", () => {
  const r = stripArtistReferences("slow piano ballad, sounds like Kacey Musgraves, no drums");
  assert.equal(r.text, "slow piano ballad, no drums");
  assert.deepEqual(r.removed, ["sounds like Kacey Musgraves"]);
  assert.equal(stripArtistReferences("big choir like Adele").text, "big choir");
});

test("titles shorten at a word boundary and report it", () => {
  const t = fitTitle("A very long title that keeps going and going well past the eighty character limit for Suno");
  assert.ok(t.changed);
  assert.ok(t.title.length <= 80);
  assert.ok(!t.title.endsWith(" "));
});

test("phonetic respelling replaces whole words only and is validated after expansion", () => {
  const b = brief({ recipient: { name: "Ann", sungAs: "Ahn-nuh-mah-REE-ah", relationship: "mom", pronouns: "she", nicknames: [] }, mustInclude: ["Ann"] });
  const sung = toSungLyrics("Ann, Annie and Annabel", b);
  assert.equal(sung, "Ahn-nuh-mah-REE-ah, Annie and Annabel");
  // A long respelling can push a near-limit sheet over the provider limit: caught, not truncated.
  const l = goodLyrics();
  const display = renderLyrics(l) + "\n" + "Ann ".repeat(560);
  const expanded = toSungLyrics(display, b);
  assert.ok(display.length < 5000 && expanded.length > 5000);
  const r = validateLyrics(l, { brief: b, arrangement: ARRANGEMENTS.storytelling, sungLyrics: expanded });
  assert.ok(r.issues.some((i) => i.code === "over_limit" && i.severity === "critical"));
});

test("section tags keep their numbers in the sung version", () => {
  const sung = toSungLyrics("[Verse 1]\nTurning 60 today\n\n[Verse 2]\nSince 1985", brief());
  assert.equal(sung, "[Verse 1]\nTurning sixty today\n\n[Verse 2]\nSince nineteen eighty-five");
});

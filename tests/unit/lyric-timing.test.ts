import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLyricSections, timeLyricLines } from "../../src/lib/onboarding/lyrics-view";

const lyrics = "[Verse]\nMia laughs at midnight\nCoffee on the stairs\n\n[Chorus]\nYou are my home\nYou are my home";

test("lines get the start time of their first sung word", () => {
  const words = [
    { word: "[Verse]\nMee-a ", startS: 5, endS: 5.4 },
    { word: "laughs ", startS: 5.5, endS: 6 },
    { word: "at ", startS: 6, endS: 6.2 },
    { word: "midnight\n", startS: 6.2, endS: 7 },
    { word: "Coffee ", startS: 8, endS: 8.5 },
    { word: "on the stairs\n\n", startS: 8.5, endS: 10 },
    { word: "[Chorus]\nYou ", startS: 12, endS: 12.3 },
    { word: "are my home\n", startS: 12.3, endS: 14 },
    { word: "oh ", startS: 14.2, endS: 14.5 },
    { word: "You are my home", startS: 15, endS: 17 },
  ];
  const timed = timeLyricLines(buildLyricSections(lyrics, []), words);
  const starts = timed.flatMap((s) => s.lines.map((l) => l.start));
  // The respelled name is skipped; "laughs" places the first line.
  assert.deepEqual(starts, [5.5, 8, 12, 15]);
});

test("no timings means no times", () => {
  const timed = timeLyricLines(buildLyricSections(lyrics, []), []);
  assert.ok(timed.every((s) => s.lines.every((l) => l.start === null)));
});

test("a line that can't be matched is interpolated between its neighbours", () => {
  const words = [
    { word: "Mia laughs at midnight", startS: 4, endS: 7 },
    { word: "zzz qqq", startS: 8, endS: 10 },
    { word: "You are my home", startS: 12, endS: 14 },
    { word: "You are my home", startS: 16, endS: 18 },
  ];
  const starts = timeLyricLines(buildLyricSections(lyrics, []), words).flatMap((s) => s.lines.map((l) => l.start));
  assert.deepEqual(starts, [4, 8, 12, 16]);
});

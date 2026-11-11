import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLyrics, verifierIssues, compareDrafts, renderLyrics, ARRANGEMENTS, type Issue } from "../../src/lib/songcraft";
import { brief, goodLyrics, report } from "../fixtures";

const ctx = (lyrics = goodLyrics(), b = brief()) => ({ brief: b, arrangement: ARRANGEMENTS.storytelling, sungLyrics: renderLyrics(lyrics) });
const codes = (issues: Issue[], sev = "critical") => issues.filter((i) => i.severity === sev).map((i) => i.code);

test("a well-formed draft has no critical issues", () => {
  const r = validateLyrics(goodLyrics(), ctx());
  assert.deepEqual(codes(r.issues), []);
});

test("missing required section is critical", () => {
  const l = goodLyrics();
  l.sections = l.sections.filter((s) => s.tag !== "Bridge");
  assert.ok(codes(validateLyrics(l, ctx(l)).issues).includes("missing_section"));
});

test("empty sections and invalid tags are critical", () => {
  const l = goodLyrics();
  l.sections[4] = { tag: "Bridge", lines: ["  "] };
  l.sections.push({ tag: "Guitar Solo Here", lines: ["la"] });
  const c = codes(validateLyrics(l, ctx(l)).issues);
  assert.ok(c.includes("empty_section"));
  assert.ok(c.includes("invalid_tag"));
});

test("line counts far outside the arrangement are critical, slightly off is a warning", () => {
  const l = goodLyrics();
  l.sections[0] = { tag: "Verse 1", lines: ["One line only"] };
  assert.ok(codes(validateLyrics(l, ctx(l)).issues).includes("line_count"));
  const m = goodLyrics();
  m.sections[0] = { tag: "Verse 1", lines: [...m.sections[0].lines, "a", "b", "c"] };
  assert.ok(codes(validateLyrics(m, ctx(m)).issues, "warning").includes("line_count"));
});

test("repeated choruses are made identical and the change is recorded", () => {
  const l = goodLyrics();
  l.sections[3] = { tag: "Chorus", lines: ["Something else entirely", ...l.sections[1].lines.slice(1)] };
  const r = validateLyrics(l, ctx(l));
  assert.deepEqual(r.lyrics.sections[3].lines, l.sections[1].lines);
  assert.ok(r.notes.some((n) => n.includes("made identical")));
});

test("a lifted final chorus is allowed in arrangements that permit it", () => {
  const l = goodLyrics({ arrangementId: "emotional_ballad" });
  l.sections = [
    { tag: "Verse 1", lines: l.sections[0].lines },
    { tag: "Chorus", lines: l.sections[1].lines },
    { tag: "Verse 2", lines: l.sections[2].lines },
    { tag: "Chorus", lines: l.sections[1].lines },
    { tag: "Bridge", lines: l.sections[4].lines },
    { tag: "Chorus", lines: ["Linda, you're the song in the car", "Off-key and loud and right where you are", "Every Sunday you made it home", "And now I'm singing it on my own"] },
    { tag: "Outro", lines: ["Happy birthday, Linda"] },
  ];
  const r = validateLyrics(l, { brief: brief(), arrangement: ARRANGEMENTS.emotional_ballad, sungLyrics: renderLyrics(l) });
  assert.equal(r.lyrics.sections[5].lines[3], "And now I'm singing it on my own");
});

test("name missing from the chorus is critical; late placement without a note is a warning", () => {
  const l = goodLyrics();
  const ch = ["You're the song in the car", "Off-key and loud", "Every Sunday you made it home", "Still the voice that brings me home"];
  l.sections = l.sections.map((s) => (s.tag === "Chorus" ? { ...s, lines: ch } : s));
  assert.ok(codes(validateLyrics(l, ctx(l)).issues).includes("name_missing_chorus"));
  const m = goodLyrics();
  const late = ["You're the song in the car", "Off-key and loud", "Every Sunday you made it home", "Linda, you're never alone"];
  m.sections = m.sections.map((s) => (s.tag === "Chorus" ? { ...s, lines: late } : s));
  assert.ok(codes(validateLyrics(m, ctx(m)).issues, "warning").includes("name_placement"));
  m.namePlacementNote = "Ending the chorus on her name lands harder.";
  assert.ok(!codes(validateLyrics(m, ctx(m)).issues, "warning").includes("name_placement"));
});

test("required phrases, literal exclusions, blocked words and romance for a parent are critical", () => {
  const l = goodLyrics();
  l.sections[4] = { tag: "Bridge", lines: ["You're my lover and my friend", "Damn, this shit never ends"] };
  const b = brief({ mustInclude: ["Linda", "slugger"], avoid: ["romantic language", "Michigan"] });
  const c = codes(validateLyrics(l, ctx(l, b)).issues);
  assert.ok(c.includes("missing_required_phrase"));
  assert.ok(c.includes("avoid_violation"), "literal avoid word 'Michigan' used");
  assert.ok(c.includes("romantic_language"));
  assert.ok(c.includes("blocked_words"));
});

test("duplicated non-chorus sections are critical", () => {
  const l = goodLyrics();
  l.sections[2] = { tag: "Verse 2", lines: [...l.sections[0].lines] };
  assert.ok(codes(validateLyrics(l, ctx(l)).issues).includes("duplicate_section"));
});

test("fact placements must point at real facts and real lines", () => {
  const l = goodLyrics({ factPlacement: [{ factId: "fact_99", line: "x" }, { factId: "fact_01", line: "A line that is not there" }] });
  const w = codes(validateLyrics(l, ctx(l)).issues, "warning");
  assert.ok(w.includes("placement_unknown_fact"));
  assert.ok(w.includes("placement_line_missing"));
});

test("over-limit lyrics fail explicitly instead of being truncated", () => {
  const l = goodLyrics();
  const sung = renderLyrics(l) + "\n" + "la ".repeat(2000);
  const r = validateLyrics(l, { ...ctx(l), sungLyrics: sung });
  assert.ok(codes(r.issues).includes("over_limit"));
  assert.equal(renderLyrics(r.lyrics), renderLyrics(l), "lyrics were not altered");
});

test("verifier: invented details, identity and uncovered priority-1 facts block; craft never blocks", () => {
  const l = goodLyrics();
  const r = report({ pass: false, inventedDetails: [{ section: "Verse 1", line: "x", claim: "a trip to Paris" }], coverage: [{ factId: "fact_01", covered: false, evidence: "" }, { factId: "fact_02", covered: true, evidence: "" }] }, { issues: [{ category: "craft", severity: "critical", section: "Chorus", line: "", reason: "weak hook", repair: "", requiresRewrite: false }] });
  const issues = verifierIssues(r, brief(), l);
  const c = codes(issues);
  assert.ok(c.includes("invented_detail"));
  assert.ok(c.includes("missing_priority_fact"), "verifier says uncovered even though the writer placed it");
  assert.ok(issues.some((i) => i.category === "craft" && i.severity === "warning"));
});

test("draft comparison follows the hierarchy and never prefers an invalid draft", () => {
  const crit = (category: Issue["category"]): Issue => ({ code: "x", category, severity: "critical", reason: "", source: "code" });
  const warn: Issue = { code: "w", category: "craft", severity: "warning", reason: "", source: "code" };
  assert.ok(compareDrafts({ issues: [], creativeScore: 4 }, { issues: [crit("factual")], creativeScore: 9 }) < 0, "valid beats invalid regardless of score");
  assert.ok(compareDrafts({ issues: [crit("structure")], creativeScore: 4 }, { issues: [crit("factual")], creativeScore: 9 }) < 0, "factual worse than structural");
  assert.ok(compareDrafts({ issues: [warn], creativeScore: 5 }, { issues: [warn, warn], creativeScore: 9 }) < 0, "fewer warnings first");
  assert.ok(compareDrafts({ issues: [], creativeScore: 8 }, { issues: [], creativeScore: 6 }) < 0, "then creative score");
});

test("a three-line bridge is flagged as unpaired; outros and even sections are not", () => {
  const l = goodLyrics();
  l.sections = l.sections.map((s) => (s.tag === "Bridge" ? { ...s, lines: [...s.lines, "One line too many at cards"] } : s));
  const warnings = validateLyrics(l, ctx(l)).issues.filter((i) => i.code === "odd_line_count");
  assert.deepEqual(warnings.map((w) => w.section), ["Bridge"]);
  assert.deepEqual(validateLyrics(goodLyrics(), ctx()).issues.filter((i) => i.code === "odd_line_count"), []);
});

test("melodic math: a verse 2 line far longer than its verse 1 twin is flagged", () => {
  const l = goodLyrics();
  l.sections = l.sections.map((s) =>
    s.tag === "Verse 2" ? { ...s, lines: ["Up at the lake house in Michigan", "You'd sing off-key with the windows rolled all the way down and the radio blasting again", s.lines[2], s.lines[3]] } : s,
  );
  const w = validateLyrics(l, ctx(l)).issues.find((i) => i.code === "melodic_mismatch");
  assert.ok(w);
  assert.equal(w!.section, "Verse 2");
  assert.equal(validateLyrics(goodLyrics(), ctx()).issues.filter((i) => i.code === "melodic_mismatch").length, 0);
});

test("the title must be sung in the chorus's first or last line", () => {
  assert.equal(validateLyrics(goodLyrics(), ctx()).issues.filter((i) => i.code === "title_not_in_chorus").length, 0);
  const l = goodLyrics({ title: "Every Tuesday, Linda" });
  assert.ok(validateLyrics(l, ctx(l)).issues.some((i) => i.code === "title_not_in_chorus"));
  const named = goodLyrics({ title: "A Song for Linda" });
  assert.equal(validateLyrics(named, ctx(named)).issues.filter((i) => i.code === "title_not_in_chorus").length, 0, "a title that is only the name is not checked");
});

test("a chorus much wordier than the verses gets a suggestion", () => {
  const l = goodLyrics();
  const long = ["Linda, you're the one who sang the whole way down every highway we ever drove", "Off-key and loud and never caring who was listening from the other cars", "Every single Sunday morning you made the kitchen feel like home to all of us", "Linda, you were never, ever alone in any of it"];
  l.sections = l.sections.map((s) => (s.tag === "Chorus" ? { ...s, lines: long } : s));
  const i = validateLyrics(l, ctx(l)).issues.find((x) => x.code === "chorus_longer_than_verses");
  assert.ok(i);
  assert.equal(i!.severity, "suggestion");
});

test("a final chorus that rewrites three lines but keeps its hook line survives; one that drops the hook is reset and flagged", () => {
  const base = goodLyrics({ title: "Linda, Never Alone" });
  const withFinal = (final: string[]) => {
    const l = goodLyrics({ title: "Linda, Never Alone" });
    l.sections = l.sections.map((s, i) => (i === 5 ? { ...s, lines: final } : s));
    return l;
  };
  const keep = withFinal(["Linda, I'm the song in the car", "Off-key with you wherever you are", "Every Sunday I'm bringing you home", base.sections[1].lines[3]]);
  const r1 = validateLyrics(keep, ctx(keep));
  assert.equal(r1.lyrics.sections[5].lines[0], "Linda, I'm the song in the car");
  assert.equal(r1.issues.filter((i) => i.code === "final_chorus_reset").length, 0);

  const drop = withFinal(["Linda, I'm the song in the car", "Off-key with you wherever you are", "Every Sunday I'm bringing you home", "And now we sing it on our own"]);
  const r2 = validateLyrics(drop, ctx(drop));
  assert.deepEqual(r2.lyrics.sections[5].lines, base.sections[1].lines);
  assert.ok(r2.issues.some((i) => i.code === "final_chorus_reset"));
});

import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { findVerbatim, retainFacts, isDuplicateFact, verifyPhrases, buildSourceBackedBrief, relationshipConflict, normalizeBrief, type BriefLLM } from "../../src/lib/songcraft";

const story = "Mom taught me to make pancakes every Sunday. She sings off-key in the car and doesn’t care. Her happy place is the lake house in Michigan.";
const src = [{ source: "story" as const, index: 0, text: story }];

const f = (text: string, sourceQuote: string, priority = 2, type: BriefLLM["facts"][number]["type"] = "memory") => ({ type, text, priority, sourceQuote, emotionalMeaning: "", narrativeRole: "relationship_evidence" as const });

test("verbatim quotes match ignoring case, punctuation and curly apostrophes", () => {
  const hit = findVerbatim("she SINGS off-key in the car, and doesn't care", src);
  assert.ok(hit);
  assert.equal(hit!.ref.source, "story");
  assert.equal(story.slice(hit!.ref.start, hit!.ref.end), hit!.text);
});

test("a paraphrased quote falls back to the real supporting sentence", () => {
  const r = retainFacts([f("Taught me to make pancakes every Sunday", "she always made Sunday pancakes with me")], src, 12);
  assert.equal(r.facts.length, 1);
  assert.equal(r.facts[0].provenance, "matched_sentence");
  assert.match(r.facts[0].sourceQuote, /Mom taught me to make pancakes every Sunday/);
});

test("a fact with no supporting words is dropped and recorded", () => {
  const r = retainFacts([f("Won a sailing trophy in Maine", "won a sailing trophy")], src, 12);
  assert.equal(r.facts.length, 0);
  assert.equal(r.omitted[0].reason, "no_source");
});

test("priority-1 facts survive the cap even when they come last", () => {
  const extras = ["blueberries", "strawberries", "bananas", "chocolate", "pecans", "peaches"];
  const many = extras.map((x) => f(`Mom taught me to make pancakes every Sunday with ${x}`, "Mom taught me to make pancakes every Sunday", 3));
  // Distinct texts that all trace to the same sentence; the P1 fact is listed last.
  many.push(f("Her happy place is the lake house in Michigan", "Her happy place is the lake house in Michigan", 1, "place"));
  const r = retainFacts(many, src, 3);
  assert.ok(r.facts.some((x) => x.text.includes("lake house") && x.priority === 1));
  assert.equal(r.facts[0].priority, 1);
  assert.ok(r.omitted.some((o) => o.reason === "capacity"));
});

test("duplicates merge, but distinct details are never merged", () => {
  assert.equal(isDuplicateFact("Sings off-key in the car", "She sings off-key in the car"), true);
  assert.equal(isDuplicateFact("Turned 60 in Boston", "Turned 60 in Denver"), false);
  assert.equal(isDuplicateFact("Loves the lake house", "Loves the beach house"), false);
  const r = retainFacts([f("Sings off-key in the car", "sings off-key in the car", 2), f("She sings off-key in the car", "sings off-key in the car", 1)], src, 12);
  assert.equal(r.facts.length, 1);
  assert.equal(r.facts[0].priority, 1, "the higher-priority copy is kept");
  assert.equal(r.omitted[0].reason, "duplicate");
});

test("fact ids are stable and sequential", () => {
  const r = retainFacts([f("Her happy place is the lake house in Michigan", "lake house in Michigan", 1), f("Sings off-key in the car", "sings off-key in the car", 2)], src, 12);
  assert.deepEqual(r.facts.map((x) => x.id), ["fact_01", "fact_02"]);
});

test("signature phrases must appear verbatim", () => {
  const r = verifyPhrases([{ phrase: "doesn't care", kind: "saying", whyItMatters: "" }, { phrase: "rock and roll forever", kind: "saying", whyItMatters: "" }], src);
  assert.equal(r.kept.length, 1);
  assert.deepEqual(r.dropped, ["rock and roll forever"]);
});

test("must-include phrases the customer never wrote are dropped; the name is always kept", () => {
  const llm: BriefLLM = {
    recipient: { name: "Linda", sungAs: "", relationship: "mom", pronouns: "she", nicknames: ["Lindy"] },
    giverName: "",
    occasion: "birthday",
    facts: [f("Taught me to make pancakes every Sunday", "Mom taught me to make pancakes every Sunday", 1)],
    emotionalThesis: "",
    signaturePhrases: [],
    narrativeArc: [],
    contradictions: [],
    tone: [],
    mustInclude: ["lake house", "shooting star"],
    avoid: [],
    summary: "",
    followUpQuestions: [],
  };
  const b = buildSourceBackedBrief(llm, { story, relationship: "mom", recipientName: "Linda", factCap: 12 });
  assert.deepEqual(b.mustInclude, ["Linda", "lake house"]);
  assert.deepEqual(b.recipient.nicknames, [], "invented nickname dropped");
  assert.ok(b.provenanceNotes.some((n) => n.includes("shooting star")));
});

test("pronunciation hint overrides the model and follow-up answers are valid sources", () => {
  const llm = { recipient: { name: "Siobhan", sungAs: "Sio-ban", relationship: "mom", pronouns: "she" as const, nicknames: [] }, giverName: "", occasion: "", facts: [f("Calls me slugger", "calls me slugger", 1, "inside_joke")], emotionalThesis: "", signaturePhrases: [], narrativeArc: [], contradictions: [], tone: [], mustInclude: [], avoid: [], summary: "", followUpQuestions: [] };
  const b = buildSourceBackedBrief(llm, { story: "Short.", followUpAnswers: { "Q?": "She calls me slugger." }, pronunciation: "Shiv-awn", relationship: "mom", factCap: 12 });
  assert.equal(b.recipient.sungAs, "Shiv-awn");
  assert.equal(b.facts[0].sourceRef?.source, "followup");
});

test("relationship conflicts are surfaced, not resolved", () => {
  assert.ok(relationshipConflict("mom", "My dad Harold loves classic cars."));
  assert.equal(relationshipConflict("mom", "My mom and my dad met in Ohio."), null);
});

test("v1 briefs stored before provenance still load", () => {
  const b = normalizeBrief({ recipient: { name: "Dave", sungAs: "", relationship: "dad", pronouns: "he" }, occasion: "x", facts: [{ type: "trait", text: "Always there", priority: 2 }], tone: [], mustInclude: ["Dave"], avoid: [], summary: "s", followUpQuestions: [] });
  assert.ok(b);
  assert.equal(b!.facts[0].id, "fact_01");
  assert.equal(b!.facts[0].provenance, "legacy");
  assert.equal(b!.emotionalThesis, "s");
});

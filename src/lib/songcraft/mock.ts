/**
 * Deterministic stand-ins for Claude so the pipeline runs with no API key and
 * no cost. They exercise the plumbing; they are not meant to write good songs.
 *
 * Tests can override any step through `songcraftHooks` (mock mode only).
 */
import type { BriefLLM, Brief, Lyrics, QuizInput, VerifierReport } from "./types";
import type { Arrangement } from "./arrangements";
import { isChorusTag } from "./validate";
import { contentTokens } from "./provenance";

export type WriterKind = "write" | "repair" | "shorten";

export const songcraftHooks: {
  brief?: (input: QuizInput) => BriefLLM;
  writer?: (args: { kind: WriterKind; brief: Brief; arrangement: Arrangement; previous?: Lyrics; call: number }) => Lyrics;
  verifier?: (args: { brief: Brief; lyrics: Lyrics; call: number }) => VerifierReport;
} = {};

let writerCalls = 0;
let verifierCalls = 0;
export function resetMockCounters(): void {
  writerCalls = 0;
  verifierCalls = 0;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function mockBriefLLM(input: QuizInput): BriefLLM {
  if (songcraftHooks.brief) return songcraftHooks.brief(input);
  const answers = Object.values(input.followUpAnswers ?? {}).filter((a) => a && a !== "(skipped)");
  const sourceSentences = [...sentences(input.story), ...answers.flatMap(sentences)];
  const generic = /\b(best|amazing|always there|wonderful|greatest)\b/i;
  const usable = sourceSentences.filter((s) => !(generic.test(s) && contentTokens(s).length < 6));
  const facts = sourceSentences.slice(0, 12).map((s, i) => {
    const text = s.replace(/[.!?]+$/, "");
    return {
      type: /kitchen|house|lake|town|beach|road|park|school|diner/i.test(s) ? ("place" as const) : /"/.test(s) ? ("inside_joke" as const) : /always|never|every/i.test(s) ? ("trait" as const) : ("memory" as const),
      text,
      priority: i < 3 ? 1 : i < 6 ? 2 : 3,
      sourceQuote: s,
      emotionalMeaning: "shows how much they matter",
      narrativeRole: (i === 0 ? "opening_scene" : i === 1 ? "relationship_evidence" : "hook_material") as BriefLLM["facts"][number]["narrativeRole"],
    };
  });
  const quoted = [...input.story.matchAll(/"([^"]{2,40})"/g)].map((m) => m[1]);
  const name = input.recipientName?.trim() || "";
  const needMore = usable.length < 3 && !input.followUpAnswers;
  return {
    recipient: {
      name,
      sungAs: input.pronunciation?.trim() || "",
      relationship: input.relationship,
      pronouns: /mom|grandma|girlfriend|wife|sister|daughter/i.test(input.relationship) ? "she" : /dad|grandpa|boyfriend|husband|brother|son/i.test(input.relationship) ? "he" : "they",
      nicknames: [],
    },
    giverName: "",
    occasion: input.occasion.replace(/_/g, " "),
    facts,
    emotionalThesis: `You matter more than you know, ${name || "and this song says so"}.`,
    signaturePhrases: quoted.map((q) => ({ phrase: q, kind: "saying" as const, whyItMatters: "their own words" })),
    narrativeArc: ["opening recognition", "a specific memory", "what it means", "dedication"],
    contradictions: [],
    tone: [input.mood ?? "heartfelt", "warm"],
    mustInclude: [...(name ? [name] : []), ...quoted.slice(0, 1)],
    avoid: /mom|dad|grand|child|friend|cowork/i.test(input.relationship) ? ["romantic language"] : [],
    summary: `A ${input.genreKey.replace(/_/g, " ")} song for ${name || input.relationship} for their ${input.occasion.replace(/_/g, " ")}.`,
    followUpQuestions: needMore
      ? [`What is one specific memory with ${name || "them"} that always makes you smile?`, `What is something ${name || "they"} always says or does that is so them?`]
      : [],
  };
}

function factLine(text: string): string {
  const t = text.replace(/[.!?]+$/, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function mockLyrics(brief: Brief, arrangement: Arrangement, opts: { kind?: WriterKind; previous?: Lyrics } = {}): Lyrics {
  writerCalls++;
  if (songcraftHooks.writer) return songcraftHooks.writer({ kind: opts.kind ?? "write", brief, arrangement, previous: opts.previous, call: writerCalls });
  const name = brief.recipient.name || "you";
  const extra = brief.mustInclude.filter((m) => m.toLowerCase() !== name.toLowerCase());
  const chorus = [
    `${name}, this one is for you`,
    extra.length ? `They still say "${extra[0]}" when I think of you` : `Every little thing you do`,
    `You were there through every year`,
    `${name}, that's why I'm here`,
  ];
  const facts = [...brief.facts];
  const placement: Lyrics["factPlacement"] = [];
  let fi = 0;
  const nextFactLine = (): string | null => {
    const f = facts[fi++];
    if (!f) return null;
    const line = factLine(f.text);
    placement.push({ factId: f.id, line });
    return line;
  };
  const fillers = ["The way it felt, the way it still does", "That is the kind of love this is", "And I carry it with me", "Every single day"];
  const sections = arrangement.sections
    .filter((s) => !s.optional)
    .map((s) => {
      const n = s.minLines;
      if (isChorusTag(s.tag)) return { tag: s.tag, lines: chorus.slice(0, n) };
      if (/^verse/i.test(s.tag)) {
        const lines: string[] = [];
        for (let i = 0; i < n; i++) lines.push((i % 2 === 0 ? nextFactLine() : null) ?? fillers[i % fillers.length]);
        return { tag: s.tag, lines };
      }
      if (/bridge/i.test(s.tag)) return { tag: s.tag, lines: [`So here is to you, ${name}`, `For all you are and all you do`, "I hope you hear it in every line", "This song is yours and yours alone"].slice(0, n) };
      if (/intro/i.test(s.tag)) return { tag: s.tag, lines: [`This one goes out to ${name}`, "Turn it up"].slice(0, n) };
      if (/pre-chorus/i.test(s.tag)) return { tag: s.tag, lines: ["And when I say it out loud", "I hope it makes you proud"].slice(0, n) };
      return { tag: s.tag, lines: [`Happy ${brief.occasion}, ${name}`, "We love you"].slice(0, n) };
    });
  return {
    plan: {
      thesis: brief.emotionalThesis,
      centralDetail: brief.facts[0] ? `${brief.facts[0].id}: ${brief.facts[0].text}` : "",
      payoff: "feeling seen and celebrated",
      hookConcept: `${name}, this one is for you`,
      verseRoles: ["opening recognition", "deeper meaning", "turn"],
      ending: "callback to the name",
    },
    arrangementId: arrangement.id,
    title: `${name === "you" ? "You" : name}, This One Is For You`,
    sections,
    factPlacement: placement,
    namePlacementNote: "",
  };
}

export function mockVerify(brief: Brief, lyrics: Lyrics): VerifierReport {
  verifierCalls++;
  if (songcraftHooks.verifier) return songcraftHooks.verifier({ brief, lyrics, call: verifierCalls });
  const text = lyrics.sections.flatMap((s) => s.lines).join("\n").toLowerCase();
  const coverage = brief.facts.map((f) => {
    const toks = contentTokens(f.text);
    const hit = toks.filter((t) => text.includes(t)).length;
    const covered = toks.length > 0 && hit / toks.length >= 0.6;
    return { factId: f.id, covered, evidence: covered ? toks.slice(0, 4).join(" ") : "" };
  });
  const p1Missing = brief.facts.filter((f, i) => f.priority === 1 && !coverage[i].covered);
  const s = (score: number, why: string) => ({ score, why });
  return {
    factual: { pass: p1Missing.length === 0, coverage, inventedDetails: [], identityOk: true, relationshipOk: true, constraintViolations: [] },
    issues: [],
    scores: {
      emotionalImpact: s(6, "Mock score."),
      personalSpecificity: s(brief.facts.length >= 3 ? 7 : 5, "Mock score."),
      hookMemorability: s(6, "Mock score."),
      singability: s(7, "Mock score."),
      genreFit: s(6, "Mock score."),
    },
    sectionsToRepair: [],
    summary: p1Missing.length ? "Mock verifier: some priority-1 facts not found." : "Mock verifier: all priority-1 facts found.",
  };
}

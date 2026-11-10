/**
 * Step 2 of songcraft: write lyrics from the source-backed brief, check them
 * (code first, then an independent Claude verifier), repair only what is broken,
 * and return an explicit status. A draft with critical factual, constraint,
 * structure or length failures is never marked verified and can never reach
 * Suno.
 *
 * Baseline cost: one writer call + one verifier call. Repair, shortening and
 * craft passes run only when needed and are capped by LYRIC_MAX_REPAIRS.
 */
import { structured, recordMockCall } from "../llm/client";
import { env } from "../env";
import {
  LyricsSchema,
  LyricsV1Schema,
  VerifierReportSchema,
  PROMPT_VERSION,
  weightedCreativeScore,
  type Brief,
  type Lyrics,
  type VerifierReport,
} from "./types";
import { ARRANGEMENTS, describeArrangement, selectArrangement, type Arrangement, type ArrangementId } from "./arrangements";
import { isRomanticRelationship, type Genre } from "./registry";
import { mockLyrics, mockVerify, type WriterKind } from "./mock";
import { spellOutNumbers, fitTitle, LIMITS } from "./sanitize";
import {
  validateLyrics,
  verifierIssues,
  compareDrafts,
  isBlocking,
  sectionsNeedingRepair,
  renderLyrics,
  isChorusTag,
  type Issue,
} from "./validate";

export { renderLyrics } from "./validate";

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

export const LYRICIST_SYSTEM = `You are an award-winning songwriter who writes personalised gift songs that an AI music model will sing. A real person will hear their own life in this song, so it has to be true, and it has to be good.

How you work
1. Plan first (fill "plan" before anything else). Decide the emotional thesis, the single most compelling personal detail, the payoff the listener should feel at the end, the chorus hook concept, the job of each verse and the bridge, and the ending or callback. Choose the arrangement from the allowed list that best serves this story.
2. Build the song around the chorus. One central idea, natural to sing, memorable after one or two listens, and earned by the verses. Prefer a hook drawn from the customer's own phrase or the emotional thesis over generic sentiment. Put the recipient's name naturally in the first or second chorus line. Do not repeat the name over and over to fake personalisation. If the name truly sits better later in the chorus, keep it in the chorus and explain in namePlacementNote.
3. Give every verse a purpose. Usually: verse 1 establishes a recognisable moment or habit; verse 2 deepens the meaning with another detail; the bridge turns (gratitude, humour, a realisation, a wish); the final chorus and outro resolve back to the thesis. Follow the story's own logic. Never invent a chronology or a scene to fill the structure.

Truth (non-negotiable)
- Every specific claim (event, place, date, person, hobby, object, dialogue) must come from a brief fact or the customer's own quoted words. You may express feelings the story supports (see each fact's emotional meaning), but a feeling never becomes a new event.
- Every priority-1 fact must appear. Use priority-2 facts where they fit naturally. Leaving out a priority-3 fact is fine.
- Use the customer's own words where they sing well: nicknames and inside jokes exactly as spelled. Other phrases from the story are material, not lyrics: keep their meaning but reshape the grammar so the line sounds sung, never like a pasted sentence ("she does not care" becomes "you never cared who heard").
- If the brief lists contradictions, assert neither side.
- Respect the avoid list absolutely. No romance in a song for a parent, child, friend or coworker.
- Never mention real artists, bands, brands or song titles, and never quote existing songs.

Craft
- Write the way a person talks, then make it sing. Conversational beats ornate.
- One detail per line. Do not cram two facts into one line.
- Decide in the plan where every priority-1 fact lives before writing a line. A verse can carry two details on separate lines; use that instead of pushing a fact to the end. The outro never introduces a new fact: it only echoes something already sung. A fact whose narrativeRole is closing_callback is planted in a verse first, then called back at the end.
- Every chorus line has a job. The last chorus line lands the hook; it is never a filler line written to complete a rhyme. If a place name is hard to rhyme, put it mid-line instead of at the end.
- Anchor the chorus in at least one concrete image from this story (an object, place or habit), not only abstractions like "same heart, same spark".
- Verses in the same song have the same number of lines and a matching rhythm.
- Lines come in pairs. Every verse, chorus and bridge has an even number of lines (two or four), and each pair rhymes or slant-rhymes. Never leave a line hanging with no partner.
- Keep lines short enough to sing in one breath. If a line carries a fact plus a qualifier, split it or cut the qualifier.
- The bridge turns: a new perspective, a realisation, or the most tender thing in the song. It never lists facts or recaps the verses. Leave out a priority-2 fact rather than cramming it into the bridge.
- Before finishing, read every line out loud in your head and rewrite any that sound like prose, have broken grammar, or exist only for the rhyme.
- Rhyme when it comes naturally; slant rhyme is fine. Never twist word order or choose a weaker word to force a rhyme.
- Keep lines singable: similar length and stress within a section, near the syllable target, open vowels on held notes.
- Stock phrases only when they genuinely fit: stars above, destiny, angels, forever and always, "you mean the world to me", "light of my life". One real detail is worth three adjectives.
- No filler interjections unless the genre calls for them, and no self-help affirmations ("you are enough", "your journey").
- No digits, abbreviations, symbols, parentheses or stage directions inside lines. Write numbers as words.
- Follow the chosen arrangement's sections, order and line ranges. Write every chorus out in full each time it appears.

Output: plan, arrangementId, title, sections, factPlacement (every fact id you used and the exact line carrying it), namePlacementNote.`;

/** The original v1 writer prompt, kept verbatim for A/B comparison (SONGCRAFT_WRITER=v1). */
export const LYRICIST_SYSTEM_V1 = `You are a professional songwriter who writes personalised gift songs that will be sung by an AI music model. You write from a structured brief and a strict blueprint.

Hard rules:
1. Every priority-1 fact from the brief must appear clearly in the lyrics. Use priority-2 facts where they fit. Never add a fact that is not in the brief: no invented hobbies, places, dates, or events. Generic imagery (sunlight, roads, Sunday mornings) is fine; invented specifics are not.
2. The recipient's name appears in the first or second line of the chorus, and the chorus is repeated word-for-word every time it appears.
3. Follow the blueprint exactly: same sections, same order, same number of lines per section.
4. Keep every line inside the syllable range. Short, concrete, singable words. No line should be hard to say out loud.
5. Write numbers as words ("sixty", not "60"). No abbreviations, no symbols, no parentheses, no stage directions inside lines.
6. Never mention real artists, bands, brands, or song titles. Never quote existing song lyrics.
7. Respect the avoid list absolutely. For a parent or friend there is no romantic language.
8. Clean language, no profanity, nothing sexual.
9. Tone comes from the brief's tone list and the genre notes. Specific beats sentimental: one real detail is worth three adjectives.
10. factPlacement must list each brief fact you used and the exact line that carries it.`;

export const VERIFIER_SYSTEM = `You are a demanding editor and song doctor reviewing a personalised gift song before it is recorded. Check two different things and keep them separate.

1. Factual correctness (pass/fail)
Compare every specific claim in the lyrics with the brief. A claim is supported if it comes from a fact's text or source quote, the name, nicknames, occasion or relationship. Emotional interpretation that adds no new event is allowed; generic imagery is allowed. List each unsupported specific claim (event, place, date, person, hobby, object, dialogue) in inventedDetails with its section and exact line. Check name and pronouns (identityOk), that nothing contradicts the relationship (relationshipOk), and the avoid list (constraintViolations). Report coverage for every brief fact by id. factual.pass is true only if nothing is invented, identity and relationship are right, no constraint is violated, and every priority-1 fact is clearly present.

2. Songwriting quality (scores 1-10, never pass/fail)
emotionalImpact, personalSpecificity, hookMemorability, singability, genreFit. Be honest: 5 is average, 8 is genuinely good, 10 is rare.

Issues
List concrete problems with category (factual, constraint, structure, craft), severity (critical only for factual or constraint failures; craft is warning or suggestion), the section, the exact line if relevant, the reason, a specific repair that keeps the meaning, and requiresRewrite (rarely true). Craft problems to look for: a weak or generic chorus, no narrative progression, forced rhyme, awkward phrasing or unnatural stress, too many details in one line, repetitive or empty wording, a weak bridge or ending, cliches.
sectionsToRepair: tags of sections that must change to fix critical issues, plus sections with craft problems serious enough to justify a rewrite.`;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type DraftSource = "generated" | "regenerated" | "repair" | "shorten" | "edited";
export type DraftStatus = "verified" | "needs_repair" | "failed";

export type DraftEval = {
  lyrics: Lyrics;
  title: string;
  displayLyrics: string;
  sungLyrics: string;
  arrangementId: string;
  issues: Issue[];
  notes: string[];
  verifier: VerifierReport | null;
  creativeScore: number | null;
  status: DraftStatus;
  source: DraftSource;
  promptVersion: string;
};

export type WriteOptions = {
  brief: Brief;
  genre: Genre;
  mood: string | null;
  occasion?: string;
  variation?: boolean;
  writerVersion?: "v1" | "v2";
  maxRepairs?: number;
  craftRepairBelow?: number;
  polishSingabilityBelow?: number;
  /** Force an arrangement (experiments: "standard vs adaptive"). */
  arrangementOverride?: string;
};

export type WriteResult = {
  chosen: DraftEval;
  /** Every evaluated draft in order, including the chosen one. */
  attempts: DraftEval[];
  arrangement: { defaultId: string; allowed: string[]; reason: string };
};

/* -------------------------------------------------------------------------- */
/* Arrangements                                                                */
/* -------------------------------------------------------------------------- */

/** The v1 blueprint expressed as a fixed arrangement, for legacy drafts and v1 experiments. */
export function blueprintArrangement(genre: Genre): Arrangement {
  const bp = genre.blueprint;
  return {
    id: "legacy_blueprint" as ArrangementId,
    label: "Legacy blueprint",
    sections: bp.sections.map((s) => ({ tag: s.tag, minLines: s.lines, maxLines: s.lines, purpose: s.note ?? "" })),
    syllables: bp.syllables,
    dynamics: "",
    chorus: { repeat: "identical", nameRule: "first_two_lines" },
    duration: [bp.targetDuration - 20, bp.targetDuration + 20],
    vocalDensity: genre.key === "hiphop" ? 2.6 : genre.key === "lullaby" ? 1.1 : 1.7,
    instrumentalSeconds: 30,
    notes: genre.lyricNotes,
  };
}

export function getArrangement(id: string | null | undefined, genre: Genre): Arrangement {
  if (id && id in ARRANGEMENTS) return ARRANGEMENTS[id as ArrangementId];
  if (id === "legacy_blueprint") return blueprintArrangement(genre);
  return ARRANGEMENTS[genre.arrangements[0]];
}

export function resolveArrangements(genre: Genre, brief: Brief, mood: string | null, occasion: string, override?: string) {
  if (override === "legacy_blueprint") return { defaultId: "legacy_blueprint", allowed: ["legacy_blueprint"], reason: "experiment: fixed v1 blueprint" };
  if (override && genre.arrangements.includes(override as ArrangementId)) return { defaultId: override, allowed: [override], reason: "experiment override" };
  return selectArrangement(genre.arrangements, { occasion, mood, factCount: brief.facts.length });
}

/* -------------------------------------------------------------------------- */
/* Prompt assembly                                                             */
/* -------------------------------------------------------------------------- */

function describeBrief(brief: Brief): string {
  return JSON.stringify(
    {
      recipient: brief.recipient,
      relationshipIsRomantic: isRomanticRelationship(brief.recipient.relationship),
      occasion: brief.occasion,
      emotionalThesis: brief.emotionalThesis,
      tone: brief.tone,
      facts: brief.facts.map((f) => ({ id: f.id, priority: f.priority, type: f.type, fact: f.text, customerWords: f.sourceQuote, emotionalMeaning: f.emotionalMeaning, role: f.narrativeRole })),
      signaturePhrases: brief.signaturePhrases.map((p) => ({ phrase: p.phrase, kind: p.kind })),
      narrativeArc: brief.narrativeArc,
      contradictions: brief.contradictions,
      mustInclude: brief.mustInclude,
      avoid: brief.avoid,
    },
    null,
    2,
  );
}

function arrangementBlock(genre: Genre, allowed: string[], defaultId: string): string {
  return [
    `GENRE: ${genre.label}. ${genre.lyricNotes}`,
    `ALLOWED ARRANGEMENTS (default: ${defaultId}). Pick one; use the default unless another clearly serves this story better.`,
    ...allowed.map((id) => describeArrangement(getArrangement(id, genre))),
  ].join("\n\n");
}

function v1Blueprint(genre: Genre): string {
  const bp = genre.blueprint;
  return [
    `Genre: ${genre.label}. ${genre.lyricNotes}`,
    `Syllables per line: ${bp.syllables[0]} to ${bp.syllables[1]}. Rhyme: ${bp.rhyme}.`,
    `Sections, in order:`,
    ...bp.sections.map((s) => `- ${s.tag}: ${s.lines} lines${s.note ? `. ${s.note}` : ""}`),
  ].join("\n");
}

function issueList(issues: Issue[]): string {
  return issues
    .filter((i) => i.severity !== "suggestion")
    .map((i) => `- [${i.severity}/${i.category}] ${i.section ? `${i.section}: ` : ""}${i.line ? `"${i.line}" ` : ""}${i.reason}${i.repair ? ` Fix: ${i.repair}` : ""}`)
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Writer                                                                      */
/* -------------------------------------------------------------------------- */

type WriterArgs = {
  kind: WriterKind;
  opts: WriteOptions;
  sel: { defaultId: string; allowed: string[] };
  previous?: DraftEval;
  repairSections?: string[];
  craftOnly?: boolean;
};

async function callWriter(a: WriterArgs): Promise<Lyrics> {
  const { opts, sel } = a;
  const arrangement = getArrangement(a.previous?.arrangementId ?? sel.defaultId, opts.genre);
  if (env.mockLlm) {
    recordMockCall(`lyrics_${a.kind}`);
    return mockLyrics(opts.brief, arrangement, { kind: a.kind, previous: a.previous?.lyrics });
  }

  const v1 = (opts.writerVersion ?? env.writerVersion) === "v1";
  const parts: string[] = [`BRIEF:\n${describeBrief(opts.brief)}`];
  parts.push(v1 ? `\nBLUEPRINT:\n${v1Blueprint(opts.genre)}` : `\n${arrangementBlock(opts.genre, a.previous ? [a.previous.arrangementId] : sel.allowed, a.previous?.arrangementId ?? sel.defaultId)}`);
  if (opts.mood) parts.push(`\nRequested mood: ${opts.mood}`);

  if (a.kind === "repair" && a.previous) {
    const sections = a.repairSections?.length ? a.repairSections : ["(whole song)"];
    parts.push(
      `\nCURRENT DRAFT:\n${a.previous.displayLyrics}`,
      `\nPROBLEMS TO FIX:\n${issueList(a.previous.issues) || "(see sections listed)"}`,
      `\nRewrite ONLY these sections: ${sections.join(", ")}. Copy every other section exactly, word for word. Keep every brief fact already present, every required phrase and the name placement. If you change the chorus, change every chorus identically.${a.craftOnly ? " The facts are correct; improve the writing without changing what is said." : ""}`,
    );
  } else if (a.kind === "shorten" && a.previous) {
    const target = Math.floor(LIMITS.lyrics * 0.9);
    parts.push(
      `\nCURRENT DRAFT (${a.previous.sungLyrics.length} characters as sung; the provider limit is ${LIMITS.lyrics}):\n${a.previous.displayLyrics}`,
      `\nShorten it to at most ${target} characters including section tags by tightening verse and bridge lines. Keep every section, the chorus wording, every priority-1 fact, every required phrase and the ending.`,
    );
  } else if (opts.variation) {
    parts.push(`\nWrite a fresh draft from a different angle than an obvious first attempt: open on a different detail and find a different chorus hook.`);
  }

  if (v1) {
    const { output } = await structured({ operation: `lyrics_${a.kind}`, schema: LyricsV1Schema, system: LYRICIST_SYSTEM_V1, user: parts.join("\n"), effort: "high", maxTokens: 16000 });
    return fromV1(output, opts.brief);
  }
  const { output } = await structured({ operation: `lyrics_${a.kind}`, schema: LyricsSchema, system: LYRICIST_SYSTEM, user: parts.join("\n"), effort: "high", maxTokens: 24000 });
  return output;
}

/** Adapt v1 writer output to the v2 contract so both writers are judged by the same checks. */
function fromV1(v1: { title: string; sections: { tag: string; lines: string[] }[]; factPlacement: { fact: string; line: string }[] }, brief: Brief): Lyrics {
  const byText = new Map(brief.facts.map((f) => [f.text.trim().toLowerCase(), f.id]));
  return {
    plan: { thesis: "", centralDetail: "", payoff: "", hookConcept: "", verseRoles: [], ending: "" },
    arrangementId: "legacy_blueprint",
    title: v1.title,
    sections: v1.sections,
    factPlacement: v1.factPlacement.map((p) => ({ factId: byText.get(p.fact.trim().toLowerCase()) ?? p.fact, line: p.line })),
    namePlacementNote: "",
  };
}

async function callVerifier(brief: Brief, lyrics: Lyrics): Promise<VerifierReport> {
  if (env.mockLlm) {
    recordMockCall("verify");
    return mockVerify(brief, lyrics);
  }
  const { output } = await structured({
    operation: "verify",
    schema: VerifierReportSchema,
    system: VERIFIER_SYSTEM,
    user: `BRIEF:\n${describeBrief(brief)}\n\nLYRICS:\n${renderLyrics(lyrics)}`,
    effort: "medium",
    maxTokens: 12000,
  });
  return output;
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The version Suno sings: numbers as words and the name respelled where the
 * brief says so. The customer reads the display version.
 */
export function toSungLyrics(display: string, brief: Brief): string {
  // Spell out numbers in sung lines only; section tags like [Verse 1] stay as Suno expects them.
  let sung = display
    .split("\n")
    .map((line) => (/^\s*\[[^\]]*\]\s*$/.test(line) ? line : spellOutNumbers(line).text))
    .join("\n");
  const { name, sungAs } = brief.recipient;
  if (name && sungAs && sungAs.toLowerCase() !== name.toLowerCase()) {
    const re = new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g");
    sung = sung.replace(re, sungAs);
  }
  return sung;
}

function chooseArrangementId(lyrics: Lyrics, sel: { defaultId: string; allowed: string[] }, notes: string[]): string {
  if (sel.allowed.includes(lyrics.arrangementId)) return lyrics.arrangementId;
  notes.push(`Writer chose "${lyrics.arrangementId}", which is not allowed for this genre; validated against "${sel.defaultId}".`);
  return sel.defaultId;
}

/** Restore sections a localized repair was not asked to touch. */
function restoreUntouched(repaired: Lyrics, original: Lyrics, repairSections: string[], notes: string[]): Lyrics {
  if (!repairSections.length || repairSections.includes("(whole song)")) return repaired;
  const sameShape = repaired.sections.length === original.sections.length && repaired.sections.every((s, i) => s.tag.toLowerCase() === original.sections[i].tag.toLowerCase());
  if (!sameShape) {
    notes.push("Repair changed the song's structure; all sections were re-checked.");
    return repaired;
  }
  const targets = new Set(repairSections.map((s) => s.toLowerCase()));
  const chorusTargeted = [...targets].some((t) => isChorusTag(t));
  let restored = 0;
  const sections = repaired.sections.map((s, i) => {
    const keep = isChorusTag(s.tag) ? !chorusTargeted : !targets.has(s.tag.toLowerCase());
    if (keep && s.lines.join("\n") !== original.sections[i].lines.join("\n")) {
      restored++;
      return { ...original.sections[i] };
    }
    return s;
  });
  if (restored) notes.push(`Restored ${restored} section(s) the repair was not asked to change.`);
  // Keep placements whose lines still exist, from either draft.
  const lines = new Set(sections.flatMap((s) => s.lines.map((l) => l.trim().toLowerCase())));
  const placement = [...repaired.factPlacement, ...original.factPlacement].filter((p, idx, arr) => lines.has(p.line.trim().toLowerCase()) && arr.findIndex((q) => q.factId === p.factId) === idx);
  return { ...repaired, sections, factPlacement: placement };
}

async function evaluate(
  raw: Lyrics,
  opts: WriteOptions,
  sel: { defaultId: string; allowed: string[] },
  source: DraftSource,
  extraNotes: string[] = [],
  forceArrangementId?: string,
): Promise<DraftEval> {
  const notes = [...extraNotes];
  const arrangementId = forceArrangementId ?? chooseArrangementId(raw, sel, notes);
  const arrangement = getArrangement(arrangementId, opts.genre);
  const display0 = renderLyrics(raw);
  const v = validateLyrics({ ...raw, arrangementId }, { brief: opts.brief, arrangement, sungLyrics: toSungLyrics(display0, opts.brief) });
  notes.push(...v.notes);
  const lyrics = v.lyrics;
  const displayLyrics = renderLyrics(lyrics);
  const sungLyrics = toSungLyrics(displayLyrics, opts.brief);
  const t = fitTitle(lyrics.title.trim() || `A Song for ${opts.brief.recipient.name || "You"}`);
  if (t.changed) notes.push(`Title shortened at a word boundary to fit ${LIMITS.title} characters.`);

  let issues = v.issues;
  let verifier: VerifierReport | null = null;
  // Structure or length failures are repaired before spending a verifier call.
  const structurallyBroken = issues.some((i) => i.severity === "critical" && (i.category === "structure" || i.category === "api"));
  if (!structurallyBroken) {
    verifier = await callVerifier(opts.brief, lyrics);
    issues = [...issues, ...verifierIssues(verifier, opts.brief, lyrics)];
  }
  const blocking = isBlocking(issues);
  return {
    lyrics,
    title: t.title,
    displayLyrics,
    sungLyrics,
    arrangementId,
    issues,
    notes,
    verifier,
    creativeScore: verifier ? weightedCreativeScore(verifier.scores) : null,
    status: blocking ? "needs_repair" : verifier ? "verified" : "needs_repair",
    source,
    promptVersion: `${PROMPT_VERSION}/${opts.writerVersion ?? env.writerVersion}`,
  };
}

function better(a: DraftEval, b: DraftEval): DraftEval {
  // Never replace a valid draft with an invalid one; ties keep the earlier draft.
  if (!isBlocking(a.issues) && isBlocking(b.issues)) return a;
  return compareDrafts(b, a) < 0 ? b : a;
}

/* -------------------------------------------------------------------------- */
/* Main entry                                                                  */
/* -------------------------------------------------------------------------- */

export async function writeLyrics(opts: WriteOptions): Promise<WriteResult> {
  const sel = resolveArrangements(opts.genre, opts.brief, opts.mood, opts.occasion ?? opts.brief.occasion, opts.arrangementOverride ?? ((opts.writerVersion ?? env.writerVersion) === "v1" ? "legacy_blueprint" : undefined));
  const maxRepairs = opts.maxRepairs ?? env.lyricMaxRepairs;
  const craftBelow = opts.craftRepairBelow ?? env.lyricCraftRepairBelow;
  const singBelow = opts.polishSingabilityBelow ?? env.lyricPolishSingabilityBelow;
  const attempts: DraftEval[] = [];
  let repairsLeft = maxRepairs;

  const first = await evaluate(await callWriter({ kind: "write", opts, sel }), opts, sel, opts.variation ? "regenerated" : "generated");
  attempts.push(first);
  let best = first;

  // 1. Over the provider limit: one targeted shortening pass (counts as a repair).
  if (best.issues.some((i) => i.code === "over_limit") && repairsLeft > 0) {
    repairsLeft--;
    const shorter = await evaluate(await callWriter({ kind: "shorten", opts, sel, previous: best }), opts, sel, "shorten", [], best.arrangementId);
    attempts.push(shorter);
    best = better(best, shorter);
  }

  // 2. Critical failures: localized repair of the sections involved.
  while (isBlocking(best.issues) && repairsLeft > 0) {
    repairsLeft--;
    const sections = sectionsNeedingRepair(best.issues, best.verifier?.sectionsToRepair);
    const notes: string[] = [];
    const repairedRaw = await callWriter({ kind: "repair", opts, sel, previous: best, repairSections: sections });
    const restored = restoreUntouched(repairedRaw, best.lyrics, sections, notes);
    const repaired = await evaluate(restored, opts, sel, "repair", notes, best.arrangementId);
    attempts.push(repaired);
    best = better(best, repaired);
  }

  // 3. Valid but weak, or hard to sing: one optional polish pass, only if budget remains.
  //    craftRepairBelow 0 turns polishing off entirely.
  const singability = best.verifier?.scores?.singability?.score ?? null;
  const weak = best.creativeScore !== null && best.creativeScore < craftBelow;
  const hardToSing = singBelow > 0 && singability !== null && singability < singBelow;
  if (!isBlocking(best.issues) && craftBelow > 0 && (weak || hardToSing) && repairsLeft > 0) {
    repairsLeft--;
    const craftIssues = best.issues.filter((i) => (i.category === "craft" || i.category === "structure") && i.severity !== "suggestion");
    const sections = sectionsNeedingRepair(craftIssues.map((i) => ({ ...i, requiresRewrite: true })), best.verifier?.sectionsToRepair);
    const notes: string[] = [];
    const repairedRaw = await callWriter({ kind: "repair", opts, sel, previous: best, repairSections: sections, craftOnly: true });
    const restored = restoreUntouched(repairedRaw, best.lyrics, sections, notes);
    const repaired = await evaluate(restored, opts, sel, "repair", notes, best.arrangementId);
    attempts.push(repaired);
    best = better(best, repaired);
  }

  const chosen: DraftEval = { ...best, status: isBlocking(best.issues) || !best.verifier ? "failed" : "verified" };
  return { chosen, attempts: attempts.map((a) => (a === best ? chosen : a)), arrangement: sel };
}

/** Check a customer's hand edit: code checks plus the verifier, no automatic rewriting of their words. */
export async function evaluateEditedLyrics(text: string, opts: WriteOptions & { title: string; arrangementId: string | null; previousPlacement?: { factId: string; line: string }[] }): Promise<DraftEval | { error: string }> {
  const parsed = parseEditedLyrics(text);
  if ("error" in parsed) return parsed;
  const arrangementId = opts.arrangementId ?? opts.genre.arrangements[0];
  const lyrics: Lyrics = { ...parsed, title: opts.title, arrangementId, factPlacement: opts.previousPlacement ?? [] };
  const e = await evaluate(lyrics, opts, { defaultId: arrangementId, allowed: [arrangementId] }, "edited", [], arrangementId);
  return { ...e, status: isBlocking(e.issues) || !e.verifier ? "failed" : "verified" };
}

/** Parse "[Tag]\nline\nline\n\n[Tag]..." text into sections. */
export function parseEditedLyrics(text: string): Lyrics | { error: string } {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const sections: Lyrics["sections"] = [];
  for (const block of blocks) {
    const m = block.match(/^\[([^\]]+)\]\s*\n?([\s\S]*)$/);
    if (!m) return { error: `Each section must start with a tag like [Chorus]. Problem near: "${block.slice(0, 30)}"` };
    const lines = m[2].split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { error: `Section [${m[1]}] has no lines.` };
    sections.push({ tag: m[1].trim(), lines });
  }
  if (!sections.some((s) => /chorus/i.test(s.tag))) return { error: "Lyrics need at least one [Chorus] section." };
  return { plan: { thesis: "", centralDetail: "", payoff: "", hookConcept: "", verseRoles: [], ending: "" }, arrangementId: "", title: "", sections, factPlacement: [], namePlacementNote: "" };
}

/** Is a stored draft allowed to go to Suno? Legacy (pre-v2) drafts use their stored v1 verifier verdict. */
export function draftIsSingable(d: { status: string | null; verifierReport: Record<string, unknown> | null }): boolean {
  if (d.status) return d.status === "verified";
  return (d.verifierReport as { pass?: boolean } | null)?.pass === true;
}

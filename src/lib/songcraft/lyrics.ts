/**
 * Step 2 of songcraft: write lyrics from the brief against the genre blueprint,
 * then verify them against the brief and repair once if needed.
 */
import { structured } from "../llm/client";
import { env } from "../env";
import { LyricsSchema, VerifierReportSchema, type Brief, type Lyrics, type VerifierReport } from "./types";
import type { Genre } from "./registry";
import { mockLyrics, mockVerify } from "./mock";
import { findProfanity, spellOutSmallNumbers, LIMITS, clamp } from "./sanitize";

const LYRICIST_SYSTEM = `You are a professional songwriter who writes personalised gift songs that will be sung by an AI music model. You write from a structured brief and a strict blueprint.

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

const VERIFIER_SYSTEM = `You are a meticulous editor checking a gift song's lyrics against the brief they were written from. You are the last line of defence against embarrassing mistakes: invented facts, the wrong name, wrong relationship tone, and lines a singer cannot deliver.

Check, in order:
1. Every priority-1 fact is clearly present. Quote the line as evidence.
2. Invented details: any specific claim (a place, event, hobby, date, person) that is NOT in the brief. List each one. This is an error.
3. The recipient's name appears in the chorus. Missing name is an error.
4. The avoid list is respected. A violation is an error.
5. Profanity, sexual content, real artist or brand names: error.
6. Lines that are awkward to sing (tongue twisters, digits, abbreviations): warning.
7. Chorus repeated identically: a changed chorus is a warning.

pass is true only with zero errors. repairInstructions must be concrete: which line, what to change, what to keep.`;

function describeBlueprint(genre: Genre): string {
  const bp = genre.blueprint;
  return [
    `Genre: ${genre.label}. ${genre.lyricNotes}`,
    `Syllables per line: ${bp.syllables[0]} to ${bp.syllables[1]}. Rhyme: ${bp.rhyme}.`,
    `Sections, in order:`,
    ...bp.sections.map((s) => `- ${s.tag}: ${s.lines} lines${s.note ? `. ${s.note}` : ""}`),
  ].join("\n");
}

function describeBrief(brief: Brief): string {
  return JSON.stringify(
    {
      recipient: brief.recipient,
      occasion: brief.occasion,
      tone: brief.tone,
      facts: brief.facts.map((f) => `[P${f.priority}] (${f.type}) ${f.text}`),
      mustInclude: brief.mustInclude,
      avoid: brief.avoid,
    },
    null,
    2,
  );
}

export async function generateLyrics(opts: {
  brief: Brief;
  genre: Genre;
  mood: string | null;
  previous?: { lyrics: Lyrics; feedback: string } | null;
  variation?: boolean;
}): Promise<Lyrics> {
  if (env.mockLlm) return mockLyrics(opts.brief, opts.genre);

  const parts = [
    `BRIEF:\n${describeBrief(opts.brief)}`,
    `\nBLUEPRINT:\n${describeBlueprint(opts.genre)}`,
    opts.mood ? `\nRequested mood: ${opts.mood}` : "",
  ];
  if (opts.previous) {
    parts.push(
      `\nPREVIOUS DRAFT (needs fixing):\n${renderLyrics(opts.previous.lyrics)}`,
      `\nEDITOR NOTES, fix all of these while keeping what works:\n${opts.previous.feedback}`,
    );
  } else if (opts.variation) {
    parts.push(`\nWrite a fresh draft from a different angle than an obvious first attempt: open on a different fact, use a different chorus hook.`);
  }
  const { output } = await structured({
    schema: LyricsSchema,
    system: LYRICIST_SYSTEM,
    user: parts.join("\n"),
    effort: "high",
    maxTokens: 6000,
  });
  return output;
}

export async function verifyLyrics(brief: Brief, lyrics: Lyrics): Promise<VerifierReport> {
  if (env.mockLlm) return mockVerify(brief, lyrics);
  const { output } = await structured({
    schema: VerifierReportSchema,
    system: VERIFIER_SYSTEM,
    user: `BRIEF:\n${describeBrief(brief)}\n\nLYRICS:\n${renderLyrics(lyrics)}`,
    effort: "medium",
    maxTokens: 4000,
  });
  return output;
}

/** Render sections into Suno's tagged lyric format. */
export function renderLyrics(lyrics: Lyrics): string {
  return lyrics.sections.map((s) => `[${s.tag}]\n${s.lines.join("\n")}`).join("\n\n");
}

/**
 * Two texts from one draft: what the customer reads, and what Suno sings.
 * They differ only in the phonetic respelling of the name and digit spelling.
 */
export function toSungLyrics(display: string, brief: Brief): string {
  let sung = spellOutSmallNumbers(display);
  const { name, sungAs } = brief.recipient;
  if (name && sungAs && sungAs.toLowerCase() !== name.toLowerCase()) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    sung = sung.replace(re, sungAs);
  }
  return clamp(sung, LIMITS.lyrics);
}

export type LyricDraftResult = {
  title: string;
  displayLyrics: string;
  sungLyrics: string;
  report: VerifierReport;
  attempts: number;
};

/**
 * Generate, verify, repair once, verify again. Always returns a draft; the
 * report tells the UI whether warnings remain. Hard local checks (profanity,
 * length) run regardless of the model's own verdict.
 */
export async function writeLyrics(opts: {
  brief: Brief;
  genre: Genre;
  mood: string | null;
  variation?: boolean;
}): Promise<LyricDraftResult> {
  let lyrics = await generateLyrics(opts);
  let report = await verifyLyrics(opts.brief, lyrics);
  let attempts = 1;

  if (!report.pass && report.repairInstructions) {
    const repaired = await generateLyrics({ ...opts, previous: { lyrics, feedback: report.repairInstructions } });
    const repairedReport = await verifyLyrics(opts.brief, repaired);
    attempts = 2;
    // Keep whichever draft has fewer errors.
    const errs = (r: VerifierReport) => r.issues.filter((i) => i.severity === "error").length + r.inventedDetails.length;
    if (errs(repairedReport) <= errs(report)) {
      lyrics = repaired;
      report = repairedReport;
    }
  }

  const display = renderLyrics(lyrics);
  const profanity = findProfanity(display);
  if (profanity.length) {
    report = {
      ...report,
      pass: false,
      issues: [...report.issues, { severity: "error", message: `Contains blocked words: ${profanity.join(", ")}` }],
    };
  }
  return {
    title: clamp(lyrics.title.trim() || `A Song for ${opts.brief.recipient.name || "You"}`, LIMITS.title),
    displayLyrics: display,
    sungLyrics: toSungLyrics(display, opts.brief),
    report,
    attempts,
  };
}

/** Validate a customer's manual edit without calling the model for anything but verification. */
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
  return { title: "", sections, factPlacement: [] };
}

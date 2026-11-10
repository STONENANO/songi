/**
 * Deterministic lyric validation. Anything code can check exactly is checked
 * here, not by Claude: structure, required sections, line counts, chorus
 * consistency, name placement, required phrases, blocked words, numbers,
 * limits and fact-placement references.
 *
 * Semantic checks (is a fact really expressed, is anything invented) stay with
 * the Claude verifier; `gateDraft` merges both into one decision.
 */
import type { Arrangement } from "./arrangements";
import type { Brief, Lyrics, VerifierReport } from "./types";
import { findProfanity, spellOutNumbers, LIMITS } from "./sanitize";
import { isRomanticRelationship } from "./registry";

export type IssueCategory = "factual" | "constraint" | "structure" | "api" | "craft";
export type IssueSeverity = "critical" | "warning" | "suggestion";

export type Issue = {
  code: string;
  category: IssueCategory;
  severity: IssueSeverity;
  section?: string;
  line?: string;
  reason: string;
  repair?: string;
  requiresRewrite?: boolean;
  source: "code" | "verifier";
};

export const VALID_TAG = /^(intro|verse(\s+\d+)?|pre-chorus|chorus|final chorus|post-chorus|bridge|hook|outro|break|breakdown|interlude|refrain)$/i;

const ROMANTIC_TERMS = ["lover", "make love", "kiss me", "sexy", "seduce", "romance", "in my bed", "your lips on", "my valentine"];

export function isChorusTag(tag: string): boolean {
  return /^(final\s+)?chorus$/i.test(tag.trim());
}

export function renderLyrics(lyrics: Pick<Lyrics, "sections">): string {
  return lyrics.sections.map((s) => `[${s.tag}]\n${s.lines.join("\n")}`).join("\n\n");
}

/** Rough English syllable estimate, good enough to flag lines far outside a target range. */
export function syllables(line: string): number {
  return (line.toLowerCase().match(/[a-z']+/g) ?? []).reduce((n, w) => {
    const word = w.replace(/'/g, "").replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = word.match(/[aeiouy]{1,2}/g);
    return n + Math.max(1, groups ? groups.length : 0);
  }, 0);
}

function hasWord(text: string, phrase: string): boolean {
  const p = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${p}(?![A-Za-z0-9])`, "i").test(text);
}

/** An avoid-list entry is literal when it names words, not a theme ("romantic language" is a theme). */
function isLiteralAvoid(entry: string): boolean {
  const e = entry.trim().toLowerCase();
  return e.split(/\s+/).length <= 3 && !/(language|themes?|topics?|references?|content|mentions?|talk|anything)/.test(e);
}

export type ValidateContext = {
  brief: Brief;
  arrangement: Arrangement;
  /** Lyrics exactly as Suno will receive them (after phonetic respelling). */
  sungLyrics: string;
  lyricLimit?: number;
};

export type ValidationResult = {
  issues: Issue[];
  /** Lyrics after deterministic normalisation (empty lines removed, repeated choruses unified). */
  lyrics: Lyrics;
  notes: string[];
};

/** Normalise what code can fix exactly, then report everything else. */
export function validateLyrics(input: Lyrics, ctx: ValidateContext): ValidationResult {
  const issues: Issue[] = [];
  const notes: string[] = [];
  const add = (i: Omit<Issue, "source">) => issues.push({ ...i, source: "code" });

  // --- Normalise: trim lines, drop blank lines, trim tags.
  let sections = input.sections.map((s) => ({ tag: s.tag.replace(/^\[|\]$/g, "").trim(), lines: s.lines.map((l) => l.trim()).filter(Boolean) }));

  // --- Chorus consistency: unify repeats deterministically, allowing a lifted final chorus where the arrangement permits it.
  const chorusIdx = sections.map((s, i) => (isChorusTag(s.tag) ? i : -1)).filter((i) => i >= 0);
  if (chorusIdx.length > 1) {
    const first = sections[chorusIdx[0]].lines;
    chorusIdx.slice(1).forEach((idx, k) => {
      const isFinal = k === chorusIdx.length - 2;
      const cur = sections[idx].lines;
      const same = cur.length === first.length && cur.every((l, j) => l === first[j]);
      if (same) return;
      const diff = cur.filter((l, j) => l !== first[j]).length + Math.abs(cur.length - first.length);
      if (isFinal && ctx.arrangement.chorus.repeat === "final_may_lift" && diff <= 2 && cur.length === first.length) return;
      sections[idx] = { ...sections[idx], lines: [...first] };
      notes.push(`Chorus ${k + 2} differed from the first chorus and was made identical.`);
    });
  }
  const lyrics: Lyrics = { ...input, sections };

  // --- Section tags and emptiness.
  sections.forEach((s) => {
    if (!VALID_TAG.test(s.tag)) add({ code: "invalid_tag", category: "structure", severity: "critical", section: s.tag, reason: `"${s.tag}" is not a section tag Suno understands.`, repair: "Use the arrangement's tags." });
    if (!s.lines.length) add({ code: "empty_section", category: "structure", severity: "critical", section: s.tag, reason: "Section has no lines." });
  });

  // --- Structure against the arrangement (optional sections may be skipped).
  const spec = ctx.arrangement.sections;
  let i = 0;
  const unexpected: string[] = [];
  for (const sp of spec) {
    const cur = sections[i];
    const tagMatches = cur && (cur.tag.toLowerCase() === sp.tag.toLowerCase() || (isChorusTag(sp.tag) && isChorusTag(cur.tag)));
    if (tagMatches) {
      const n = cur.lines.length;
      if (n < sp.minLines || n > sp.maxLines) {
        const far = n < sp.minLines - 1 || n > sp.maxLines + 2;
        add({ code: "line_count", category: "structure", severity: far ? "critical" : "warning", section: cur.tag, reason: `${n} lines; the arrangement expects ${sp.minLines === sp.maxLines ? sp.minLines : `${sp.minLines}-${sp.maxLines}`}.`, repair: `Write ${sp.minLines}-${sp.maxLines} lines.` });
      }
      i++;
      continue;
    }
    if (sp.optional) continue;
    // Look ahead: an unexpected extra section before the expected one.
    const ahead = sections.slice(i).findIndex((s) => s.tag.toLowerCase() === sp.tag.toLowerCase() || (isChorusTag(sp.tag) && isChorusTag(s.tag)));
    if (ahead > 0) {
      for (const s of sections.slice(i, i + ahead)) unexpected.push(s.tag);
      i += ahead + 1;
      continue;
    }
    add({ code: "missing_section", category: "structure", severity: "critical", section: sp.tag, reason: `Required section [${sp.tag}] is missing or out of order.`, repair: `Follow the ${ctx.arrangement.id} arrangement order.` });
  }
  for (const s of sections.slice(i)) unexpected.push(s.tag);
  for (const t of unexpected) add({ code: "unexpected_section", category: "structure", severity: "warning", section: t, reason: `[${t}] is not part of the ${ctx.arrangement.id} arrangement.` });

  // --- Sections sing in pairs of lines; an odd count (other than a one-line tag) leaves a line with no partner.
  for (const s of sections) {
    const n = s.lines.length;
    if (n > 1 && n % 2 === 1 && /^(verse|chorus|bridge|pre-chorus)/i.test(s.tag)) {
      add({ code: "odd_line_count", category: "craft", severity: "warning", section: s.tag, reason: `${n} lines: the last line has no rhyme partner and the melody phrase comes out lopsided.`, repair: `Write ${n - 1} or ${n + 1} lines that pair up.` });
    }
  }

  // --- Verses should match each other in length so the melody can repeat.
  const verseLens = sections.filter((s) => /^verse/i.test(s.tag)).map((s) => s.lines.length);
  if (verseLens.length > 1 && new Set(verseLens).size > 1) {
    add({ code: "verse_length_mismatch", category: "craft", severity: "warning", reason: `Verses have different lengths (${verseLens.join(", ")} lines), which makes the melody hard to repeat.`, repair: "Give every verse the same number of lines." });
  }

  // --- Duplicated non-chorus sections (a common generation glitch).
  const seen = new Map<string, string>();
  for (const s of sections) {
    if (isChorusTag(s.tag) || /pre-chorus/i.test(s.tag)) continue;
    const key = s.lines.join("\n").toLowerCase();
    if (seen.has(key)) add({ code: "duplicate_section", category: "structure", severity: "critical", section: s.tag, reason: `Repeats [${seen.get(key)}] word for word.`, repair: "Write new lines for this section." });
    else seen.set(key, s.tag);
  }

  const allText = sections.flatMap((s) => s.lines).join("\n");
  const chorus = sections.find((s) => isChorusTag(s.tag));

  // --- Recipient name in the chorus.
  const names = [ctx.brief.recipient.name, ...ctx.brief.recipient.nicknames].map((n) => n.trim()).filter(Boolean);
  if (names.length && chorus) {
    const inChorus = chorus.lines.some((l) => names.some((n) => hasWord(l, n)));
    const inFirstTwo = chorus.lines.slice(0, 2).some((l) => names.some((n) => hasWord(l, n)));
    if (!inChorus) add({ code: "name_missing_chorus", category: "factual", severity: "critical", section: "Chorus", reason: `The recipient's name (${names[0]}) is not sung in the chorus.`, repair: "Put the name in the first or second chorus line." });
    else if (!inFirstTwo && !(input.namePlacementNote ?? "").trim())
      add({ code: "name_placement", category: "craft", severity: "warning", section: "Chorus", reason: "The name is in the chorus but not in its first two lines.", repair: "Move the name earlier, or explain the exception." });
  } else if (!chorus) {
    add({ code: "no_chorus", category: "structure", severity: "critical", reason: "The song has no chorus." });
  }

  // --- Required phrases.
  for (const m of ctx.brief.mustInclude) {
    if (m.trim() && !hasWord(allText, m)) add({ code: "missing_required_phrase", category: "constraint", severity: "critical", reason: `Required phrase "${m}" does not appear.`, repair: `Use "${m}" exactly, ideally in the chorus or a verse.` });
  }

  // --- Explicit exclusions.
  for (const a of ctx.brief.avoid) {
    if (isLiteralAvoid(a) && hasWord(allText, a)) add({ code: "avoid_violation", category: "constraint", severity: "critical", reason: `Uses "${a}", which the customer asked to avoid.`, repair: `Remove "${a}".` });
  }
  if (!isRomanticRelationship(ctx.brief.recipient.relationship)) {
    for (const t of ROMANTIC_TERMS) {
      if (hasWord(allText, t)) add({ code: "romantic_language", category: "constraint", severity: "critical", reason: `Romantic wording ("${t}") in a song for a ${ctx.brief.recipient.relationship}.`, repair: "Replace with non-romantic wording." });
    }
  }

  // --- Blocked words.
  const profane = findProfanity(allText);
  if (profane.length) add({ code: "blocked_words", category: "constraint", severity: "critical", reason: `Contains blocked words: ${profane.join(", ")}.`, repair: "Replace them." });

  // --- Numbers (spelled out automatically in the sung version; flag what cannot be).
  const { unconverted } = spellOutNumbers(ctx.sungLyrics);
  if (unconverted.length) add({ code: "unsingable_number", category: "craft", severity: "warning", reason: `Numbers that cannot be sung cleanly: ${unconverted.join(", ")}.`, repair: "Write them as words." });
  if (/\d/.test(allText)) add({ code: "digits_in_display", category: "craft", severity: "suggestion", reason: "Lyrics contain digits; they are spelled out for the singer automatically." });

  // --- Line length / rhythm (guidance, not a hard rule).
  const [lo, hi] = ctx.arrangement.syllables;
  for (const s of sections) {
    for (const l of s.lines) {
      const n = syllables(l);
      if (n > Math.ceil(hi * 1.6)) add({ code: "line_too_long", category: "craft", severity: "warning", section: s.tag, line: l, reason: `About ${n} syllables; target is ${lo}-${hi}.`, repair: "Split or tighten the line." });
    }
  }

  // --- Fact-placement references must point at real facts and real lines.
  const factIds = new Set(ctx.brief.facts.map((f) => f.id));
  const lineSet = new Set(sections.flatMap((s) => s.lines.map((l) => l.trim().toLowerCase())));
  for (const p of input.factPlacement ?? []) {
    if (!factIds.has(p.factId)) add({ code: "placement_unknown_fact", category: "structure", severity: "warning", reason: `Fact placement refers to unknown fact "${p.factId}".` });
    else if (!lineSet.has(p.line.trim().toLowerCase())) add({ code: "placement_line_missing", category: "structure", severity: "warning", line: p.line, reason: `Fact placement for ${p.factId} points at a line that is not in the lyrics.` });
  }

  // --- API limits: explicit failure, never truncation.
  const limit = ctx.lyricLimit ?? LIMITS.lyrics;
  const display = renderLyrics(lyrics);
  if (display.length > limit || ctx.sungLyrics.length > limit) {
    add({ code: "over_limit", category: "api", severity: "critical", reason: `Lyrics are ${Math.max(display.length, ctx.sungLyrics.length)} characters; the provider limit is ${limit}.`, repair: "Shorten verses and bridge; keep every section, the chorus and the ending." });
  }

  return { issues, lyrics, notes };
}

/** Facts placed on real lines, by id. */
export function placedFactIds(lyrics: Lyrics): Set<string> {
  const lines = new Set(lyrics.sections.flatMap((s) => s.lines.map((l) => l.trim().toLowerCase())));
  return new Set((lyrics.factPlacement ?? []).filter((p) => lines.has(p.line.trim().toLowerCase())).map((p) => p.factId));
}

/** Convert the Claude verifier's report into issues. Craft findings never block. */
export function verifierIssues(report: VerifierReport, brief: Brief, lyrics: Lyrics): Issue[] {
  const out: Issue[] = [];
  const add = (i: Omit<Issue, "source">) => out.push({ ...i, source: "verifier" });
  for (const d of report.factual.inventedDetails) {
    add({ code: "invented_detail", category: "factual", severity: "critical", section: d.section, line: d.line, reason: `Not supported by the customer's story: ${d.claim}`, repair: "Replace with a line built from a brief fact, or with emotional interpretation that adds no new event." });
  }
  if (!report.factual.identityOk) add({ code: "identity", category: "factual", severity: "critical", reason: "Recipient name or pronouns are wrong." });
  if (!report.factual.relationshipOk) add({ code: "relationship", category: "factual", severity: "critical", reason: "Lyrics contradict the relationship." });
  for (const v of report.factual.constraintViolations) add({ code: "constraint", category: "constraint", severity: "critical", section: v.section, line: v.line, reason: `Violates: ${v.constraint}` });

  // Priority-1 coverage is a semantic judgement, so the independent verifier decides. The writer's own
  // fact placement is used only when the verifier did not assess a fact at all.
  const placed = placedFactIds(lyrics);
  for (const f of brief.facts.filter((x) => x.priority === 1)) {
    const c = report.factual.coverage.find((x) => x.factId === f.id);
    const missing = c ? !c.covered : !placed.has(f.id);
    if (missing) add({ code: "missing_priority_fact", category: "factual", severity: "critical", reason: `Priority-1 detail missing: ${f.text}`, repair: "Work this detail into a verse or the chorus." });
  }
  for (const i of report.issues) {
    // The verifier may call craft problems "critical"; craft never blocks generation.
    const severity: IssueSeverity = i.category === "craft" && i.severity === "critical" ? "warning" : i.severity;
    if (i.category === "factual" && out.some((o) => o.code === "invented_detail" && o.line === i.line)) continue;
    add({ code: `verifier_${i.category}`, category: i.category, severity, section: i.section, line: i.line, reason: i.reason, repair: i.repair, requiresRewrite: i.requiresRewrite });
  }
  if (!report.factual.pass && !out.some((o) => o.severity === "critical" && (o.category === "factual" || o.category === "constraint"))) {
    add({ code: "factual_fail", category: "factual", severity: "critical", reason: report.summary || "The verifier did not pass the facts." });
  }
  return out;
}

export function countIssues(issues: Issue[]) {
  const crit = (c: IssueCategory) => issues.filter((i) => i.severity === "critical" && i.category === c).length;
  return {
    factual: crit("factual"),
    constraint: crit("constraint"),
    structural: crit("structure") + crit("api"),
    critical: issues.filter((i) => i.severity === "critical").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}

/**
 * Compare two drafts. Negative = `a` is better. Hierarchy:
 * 1. fewer critical factual failures, 2. fewer constraint failures,
 * 3. valid structure / API, 4. fewer warnings, 5. higher creative score.
 */
export function compareDrafts(a: { issues: Issue[]; creativeScore: number | null }, b: { issues: Issue[]; creativeScore: number | null }): number {
  const ca = countIssues(a.issues);
  const cb = countIssues(b.issues);
  if (ca.factual !== cb.factual) return ca.factual - cb.factual;
  if (ca.constraint !== cb.constraint) return ca.constraint - cb.constraint;
  if (ca.structural !== cb.structural) return ca.structural - cb.structural;
  if (ca.warnings !== cb.warnings) return ca.warnings - cb.warnings;
  return (b.creativeScore ?? 0) - (a.creativeScore ?? 0);
}

export function isBlocking(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "critical");
}

/** Sections a repair should touch, from critical and section-level issues. */
export function sectionsNeedingRepair(issues: Issue[], verifierSections: string[] = []): string[] {
  const s = new Set<string>(verifierSections);
  for (const i of issues) if ((i.severity === "critical" || i.requiresRewrite) && i.section) s.add(i.section);
  return [...s];
}

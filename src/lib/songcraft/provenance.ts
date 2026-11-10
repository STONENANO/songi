/**
 * Provenance: every fact in a brief must trace back to words the customer
 * actually typed. This module verifies the model's quotes against the source
 * text, deduplicates without merging distinct details, and decides which facts
 * survive the cap (priority first, then distinctiveness), recording what was
 * dropped and why.
 */
import {
  BRIEF_VERSION,
  clampPriority,
  type Brief,
  type BriefFact,
  type BriefLLM,
  type OmittedFact,
  type SignaturePhrase,
  type SourceRef,
} from "./types";

export type SourceText = { source: "story" | "followup"; index: number; text: string };

const STOP = new Set(
  "a an the and or but of to in on at for with my me i we us our you your he she they him her his hers their them it its is was were be been are am do does did has have had that this these those so very just really always never every when where who what how as by from up out about into over after before than then there here".split(
    " ",
  ),
);

export function normalizeApostrophes(s: string): string {
  return s.replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"');
}

function words(s: string): string[] {
  return normalizeApostrophes(s).toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
}

export function contentTokens(s: string): string[] {
  return words(s).filter((w) => !STOP.has(w) && w.length > 1);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find `quote` verbatim in any source, ignoring case, punctuation and whitespace. */
export function findVerbatim(quote: string, sources: SourceText[]): { ref: SourceRef; text: string } | null {
  const toks = normalizeApostrophes(quote).match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g);
  if (!toks || toks.length === 0) return null;
  const re = new RegExp(`(?<![A-Za-z0-9])${toks.map(escapeRe).join("[^A-Za-z0-9]+")}(?![A-Za-z0-9])`, "i");
  for (const s of sources) {
    const text = normalizeApostrophes(s.text);
    const m = re.exec(text);
    if (m) return { ref: { source: s.source, index: s.index, start: m.index, end: m.index + m[0].length }, text: s.text.slice(m.index, m.index + m[0].length) };
  }
  return null;
}

function sentences(s: SourceText): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s.text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t.length > 2) out.push({ start: m.index + lead, end: m.index + lead + t.length, text: t });
  }
  return out;
}

/**
 * When the model paraphrased its "quote", fall back to the real sentence that
 * best supports the fact. Requires substantial overlap of content words so an
 * unrelated sentence is never attached to an invented fact.
 */
export function bestSupportingSentence(
  factText: string,
  quote: string,
  sources: SourceText[],
  minOverlap = 0.5,
): { ref: SourceRef; text: string; overlap: number } | null {
  const want = new Set([...contentTokens(factText), ...contentTokens(quote)]);
  const factToks = new Set(contentTokens(factText));
  if (want.size === 0) return null;
  let best: { ref: SourceRef; text: string; overlap: number } | null = null;
  for (const s of sources) {
    for (const sent of sentences(s)) {
      const have = new Set(contentTokens(sent.text));
      let hit = 0;
      for (const t of factToks) if (have.has(t)) hit++;
      const overlap = factToks.size ? hit / factToks.size : 0;
      if (overlap >= minOverlap && (!best || overlap > best.overlap)) {
        best = { ref: { source: s.source, index: s.index, start: sent.start, end: sent.end }, text: sent.text, overlap };
      }
    }
  }
  return best;
}

/** Proper nouns, numbers and quoted strings: the details that must never be merged away. */
function distinctiveTokens(text: string): Set<string> {
  const out = new Set<string>();
  const t = normalizeApostrophes(text);
  for (const m of t.matchAll(/\b\d+(?:st|nd|rd|th)?\b/g)) out.add(m[0].toLowerCase());
  for (const m of t.matchAll(/(?<!^)(?<![.!?]\s)\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g)) out.add(m[0].toLowerCase());
  for (const m of t.matchAll(/"([^"]+)"/g)) out.add(m[1].toLowerCase());
  return out;
}

export function specificity(f: { text: string; type: string; sourceQuote?: string }): number {
  const toks = contentTokens(f.text);
  const typeBonus: Record<string, number> = { inside_joke: 2.5, memory: 1.5, place: 1, wish: 0.5, relationship: 0.5, trait: 0 };
  return distinctiveTokens(f.text).size * 2 + Math.min(toks.length, 10) * 0.3 + (typeBonus[f.type] ?? 0);
}

/** Two facts are duplicates only if their content words almost entirely overlap and no distinctive detail differs. */
export function isDuplicateFact(a: string, b: string): boolean {
  const na = contentTokens(a);
  const nb = contentTokens(b);
  if (!na.length || !nb.length) return false;
  if (na.join(" ") === nb.join(" ")) return true;
  const A = new Set(na);
  const B = new Set(nb);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const containment = inter / Math.min(A.size, B.size);
  // Duplicate only if one fact is contained in the other, or they are nearly identical.
  // "Pancakes with blueberries" vs "pancakes with strawberries" each add a detail: not duplicates.
  const subset = containment === 1 && jaccard >= 0.6;
  if (!subset && jaccard < 0.85) return false;
  // Distinctive details in the smaller fact must all exist in the larger one.
  const da = distinctiveTokens(a);
  const db = distinctiveTokens(b);
  const [small, large] = da.size <= db.size ? [da, db] : [db, da];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

type Draft = Omit<BriefFact, "id">;

/**
 * Trace, deduplicate, rank and cap facts. Priority-1 facts are ranked first so
 * a late priority-1 fact can never be cut in favour of an earlier priority-3 one.
 */
export function retainFacts(
  raw: BriefLLM["facts"],
  sources: SourceText[],
  cap: number,
): { facts: BriefFact[]; omitted: OmittedFact[]; notes: string[] } {
  const omitted: OmittedFact[] = [];
  const notes: string[] = [];
  const traced: (Draft & { order: number })[] = [];

  raw.forEach((f, order) => {
    const priority = clampPriority(f.priority);
    const text = f.text.trim();
    if (!text) return;
    const exact = f.sourceQuote.trim() ? findVerbatim(f.sourceQuote, sources) : null;
    if (exact) {
      traced.push({ ...f, text, priority, sourceQuote: exact.text, sourceRef: exact.ref, provenance: "verified", order });
      return;
    }
    const fallback = bestSupportingSentence(text, f.sourceQuote, sources);
    if (fallback) {
      traced.push({ ...f, text, priority, sourceQuote: fallback.text, sourceRef: fallback.ref, provenance: "matched_sentence", order });
      if (f.sourceQuote.trim()) notes.push(`Quote for "${text}" was not verbatim; matched to the customer's sentence instead.`);
      return;
    }
    omitted.push({ text, priority, reason: "no_source" });
    notes.push(`Dropped "${text}": no supporting words found in the story or answers.`);
  });

  // Rank before deduplicating so the kept copy of a duplicate is the stronger one.
  traced.sort((a, b) => a.priority - b.priority || specificity(b) - specificity(a) || a.order - b.order);

  const kept: (Draft & { order: number })[] = [];
  for (const f of traced) {
    const dup = kept.find((k) => isDuplicateFact(k.text, f.text));
    if (dup) {
      omitted.push({ text: f.text, priority: f.priority, reason: "duplicate", mergedInto: dup.text });
      continue;
    }
    kept.push(f);
  }

  const final = kept.slice(0, cap);
  for (const f of kept.slice(cap)) omitted.push({ text: f.text, priority: f.priority, reason: "capacity" });
  if (kept.length > cap) notes.push(`${kept.length - cap} lower-ranked fact(s) omitted to stay within ${cap}.`);

  return {
    facts: final.map(({ order: _o, ...f }, i) => ({ ...f, id: `fact_${String(i + 1).padStart(2, "0")}` })),
    omitted,
    notes,
  };
}

/** Keep only phrases that appear verbatim in the customer's words. */
export function verifyPhrases(phrases: BriefLLM["signaturePhrases"], sources: SourceText[]): { kept: SignaturePhrase[]; dropped: string[] } {
  const kept: SignaturePhrase[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const p of phrases) {
    const key = p.phrase.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const hit = findVerbatim(p.phrase, sources);
    if (hit) {
      seen.add(key);
      kept.push({ phrase: hit.text, kind: p.kind, whyItMatters: p.whyItMatters, sourceRef: hit.ref });
    } else dropped.push(p.phrase);
  }
  return { kept, dropped };
}

const RELATION_WORDS: Record<string, string[]> = {
  mom: ["mom", "mother", "mum", "mama", "mommy"],
  dad: ["dad", "father", "papa", "daddy", "pop"],
  grandparent: ["grandma", "grandmother", "grandpa", "grandfather", "nana", "granny", "grandad", "grandparent"],
  partner: ["wife", "husband", "girlfriend", "boyfriend", "partner", "fiance", "fiancee", "spouse"],
  child: ["son", "daughter", "kid", "baby", "child"],
  sibling: ["brother", "sister", "sibling"],
};

/** Deterministic hint when the relationship chip conflicts with the story ("mom" chip, story only talks about "my dad"). */
export function relationshipConflict(relationship: string, story: string): { issue: string; options: string[] } | null {
  const own = RELATION_WORDS[relationship];
  if (!own) return null;
  const toks = new Set(words(story));
  if (own.some((w) => toks.has(w))) return null;
  for (const [rel, ws] of Object.entries(RELATION_WORDS)) {
    if (rel === relationship) continue;
    const hit = ws.find((w) => new RegExp(`\\bmy ${w}\\b`, "i").test(story));
    if (hit) return { issue: `Quiz says the song is for their ${relationship}, but the story talks about "my ${hit}".`, options: [relationship, hit] };
  }
  return null;
}

/**
 * Turn the model's brief into the stored, source-backed brief. Every claim
 * either traces to the customer's words or is removed, and each removal is
 * recorded in provenanceNotes.
 */
export function buildSourceBackedBrief(llm: BriefLLM, opts: { story: string; followUpAnswers?: Record<string, string> | null; recipientName?: string | null; pronunciation?: string | null; relationship: string; factCap: number }): Brief {
  const sources: SourceText[] = [{ source: "story", index: 0, text: opts.story }];
  Object.values(opts.followUpAnswers ?? {}).forEach((a, i) => {
    if (a && a !== "(skipped)") sources.push({ source: "followup", index: i, text: a });
  });

  const { facts, omitted, notes } = retainFacts(llm.facts, sources, opts.factCap);
  const phrases = verifyPhrases(llm.signaturePhrases, sources);
  for (const d of phrases.dropped) notes.push(`Dropped signature phrase "${d}": not found verbatim in the customer's words.`);

  const recipientName = llm.recipient.name.trim() || opts.recipientName?.trim() || "";
  const allowedLiterals = new Set([recipientName.toLowerCase(), ...(opts.recipientName ? [opts.recipientName.trim().toLowerCase()] : [])].filter(Boolean));
  const nicknames = llm.recipient.nicknames.filter((n) => {
    const ok = !!findVerbatim(n, sources);
    if (!ok && n.trim()) notes.push(`Dropped nickname "${n}": not found in the customer's words.`);
    return ok;
  });
  for (const n of nicknames) allowedLiterals.add(n.toLowerCase());

  // A must-include word must be the name, a nickname, or something the customer actually wrote.
  const mustInclude: string[] = [];
  for (const m of llm.mustInclude) {
    const t = m.trim();
    if (!t) continue;
    if (allowedLiterals.has(t.toLowerCase())) mustInclude.push(t);
    else {
      const hit = findVerbatim(t, sources);
      if (hit) mustInclude.push(hit.text);
      else notes.push(`Dropped required phrase "${t}": not in the customer's words.`);
    }
  }
  if (recipientName && !mustInclude.some((m) => m.toLowerCase() === recipientName.toLowerCase())) mustInclude.unshift(recipientName);

  const contradictions = [...llm.contradictions];
  const relConflict = relationshipConflict(opts.relationship, opts.story);
  if (relConflict && !contradictions.some((c) => c.issue === relConflict.issue)) contradictions.push(relConflict);

  return {
    briefVersion: BRIEF_VERSION,
    recipient: {
      name: recipientName,
      sungAs: opts.pronunciation?.trim() || llm.recipient.sungAs.trim(),
      relationship: llm.recipient.relationship || opts.relationship,
      pronouns: llm.recipient.pronouns,
      nicknames,
    },
    giverName: llm.giverName,
    occasion: llm.occasion,
    facts,
    omittedFacts: omitted,
    emotionalThesis: llm.emotionalThesis,
    signaturePhrases: phrases.kept,
    narrativeArc: llm.narrativeArc.slice(0, 6),
    contradictions,
    tone: llm.tone.slice(0, 4),
    mustInclude: [...new Set(mustInclude)],
    avoid: [...new Set(llm.avoid.map((a) => a.trim()).filter(Boolean))],
    summary: llm.summary,
    followUpQuestions: llm.followUpQuestions.slice(0, 2),
    provenanceNotes: notes,
  };
}

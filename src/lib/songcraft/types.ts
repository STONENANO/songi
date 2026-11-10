import { z } from "zod/v4";

/**
 * Songcraft data contracts.
 *
 * Two kinds of schema live here:
 *  - *LLM schemas* are what Claude must return (strict structured output, so
 *    every field is required; "nothing" is an empty string or empty array).
 *  - *Stored types* are what the pipeline persists after code has validated,
 *    traced, deduplicated and numbered the model's output.
 *
 * Field descriptions are read by the model as instructions.
 */

export const BRIEF_VERSION = 2;
export const PROMPT_VERSION = "songcraft-v2.3";

/* -------------------------------------------------------------------------- */
/* Brief                                                                       */
/* -------------------------------------------------------------------------- */

export const FactTypeSchema = z.enum(["memory", "trait", "place", "inside_joke", "relationship", "wish"]);
export type FactType = z.infer<typeof FactTypeSchema>;

export const NarrativeRoleSchema = z.enum([
  "opening_scene",
  "relationship_evidence",
  "turning_point",
  "humor",
  "gratitude",
  "wish",
  "hook_material",
  "closing_callback",
]);
export type NarrativeRole = z.infer<typeof NarrativeRoleSchema>;

export const PhraseKindSchema = z.enum(["saying", "inside_joke", "nickname", "quote", "expression"]);

export const BriefLLMSchema = z.object({
  recipient: z.object({
    name: z.string().describe("First name or nickname to sing, exactly as the customer wrote it. Empty string if none was given."),
    sungAs: z
      .string()
      .describe("Phonetic respelling for the singer ONLY if the name is likely to be mispronounced (e.g. 'Siobhan' -> 'Shiv-awn'). Otherwise empty string."),
    relationship: z.string().describe("Who the recipient is to the customer, e.g. 'mom', 'girlfriend', 'best friend'."),
    pronouns: z.enum(["she", "he", "they"]).describe("Pronouns for the recipient. Use 'they' when the story does not make it clear."),
    nicknames: z.array(z.string()).describe("Nicknames the customer actually used for the recipient, spelled exactly as written. Empty array if none."),
  }),
  giverName: z.string().describe("Name of the person giving the song, only if they wrote it. Otherwise empty string."),
  occasion: z.string().describe("The occasion, e.g. '60th birthday', 'anniversary', 'just because'."),
  facts: z
    .array(
      z.object({
        type: FactTypeSchema,
        text: z.string().describe("One concrete detail as a short plain sentence. This is the only authorised form of the claim. Never add anything the customer did not say."),
        priority: z.number().int().describe("1 = most personal and specific, must appear in the song. 2 = should appear if it fits. 3 = nice to have."),
        sourceQuote: z
          .string()
          .describe("The customer's exact words that support this fact, copied character for character from the story or a follow-up answer. Never paraphrase."),
        emotionalMeaning: z
          .string()
          .describe("What this detail says about the relationship, in a few words (e.g. 'steady, quiet support'). An interpretation, never a new event."),
        narrativeRole: NarrativeRoleSchema.describe("Where this detail would serve the song best."),
      }),
    )
    .describe("Every real, usable detail the customer gave. Between 0 and 12 items."),
  emotionalThesis: z
    .string()
    .describe("One sentence: what the song is truly trying to tell the recipient, supported by the story. Creative direction, not a lyric."),
  signaturePhrases: z
    .array(
      z.object({
        phrase: z.string().describe("The phrase exactly as the customer wrote it."),
        kind: PhraseKindSchema,
        whyItMatters: z.string(),
      }),
    )
    .describe("Memorable wording from the customer: sayings, inside jokes, nicknames, quotes, unusual expressions. Exact spelling. Empty array if none."),
  narrativeArc: z
    .array(z.string())
    .describe("3 to 5 short beats for how the song could unfold, e.g. 'opening recognition', 'the pancake memory', 'realisation', 'dedication'. Planning only."),
  contradictions: z
    .array(z.object({ issue: z.string(), options: z.array(z.string()) }))
    .describe("Conflicting or ambiguous details (different names, ages, unclear pronouns). Do not pick one; list them. Empty array if none."),
  tone: z.array(z.string()).describe("2 to 4 adjectives, e.g. ['warm', 'funny', 'grateful']."),
  mustInclude: z.array(z.string()).describe("Exact words or phrases that must appear in the lyrics (names, nicknames, inside jokes the customer clearly wants sung)."),
  avoid: z.array(z.string()).describe("Topics or words to steer clear of, inferred from relationship and story, plus anything the customer asked to leave out."),
  summary: z.string().describe("One friendly sentence the customer will see describing the song."),
  followUpQuestions: z
    .array(z.string())
    .describe("0 to 2 short, warm questions ONLY when the story is too thin for a personal song (fewer than 3 usable facts). Empty array otherwise."),
});
export type BriefLLM = z.infer<typeof BriefLLMSchema>;

export type SourceRef = {
  /** "story" or "followup" */
  source: "story" | "followup";
  /** Index of the follow-up answer (0 for the story). */
  index: number;
  /** Character offsets into that source text. */
  start: number;
  end: number;
};

/**
 * verified        - sourceQuote found verbatim (ignoring case, punctuation and spacing)
 * matched_sentence- model's quote was not verbatim; the closest real sentence is stored instead
 * legacy          - fact came from a v1 brief written before provenance existed
 */
export type Provenance = "verified" | "matched_sentence" | "legacy";

export type BriefFact = {
  id: string;
  type: FactType;
  text: string;
  priority: 1 | 2 | 3;
  sourceQuote: string;
  sourceRef: SourceRef | null;
  provenance: Provenance;
  emotionalMeaning: string;
  narrativeRole: NarrativeRole;
};

export type OmittedFact = {
  text: string;
  priority: number;
  reason: "capacity" | "duplicate" | "no_source";
  mergedInto?: string;
};

export type SignaturePhrase = {
  phrase: string;
  kind: z.infer<typeof PhraseKindSchema>;
  whyItMatters: string;
  sourceRef: SourceRef | null;
};

export type Brief = {
  briefVersion: number;
  recipient: { name: string; sungAs: string; relationship: string; pronouns: "she" | "he" | "they"; nicknames: string[] };
  giverName: string;
  occasion: string;
  facts: BriefFact[];
  omittedFacts: OmittedFact[];
  emotionalThesis: string;
  signaturePhrases: SignaturePhrase[];
  narrativeArc: string[];
  contradictions: { issue: string; options: string[] }[];
  tone: string[];
  mustInclude: string[];
  avoid: string[];
  summary: string;
  followUpQuestions: string[];
  /** Items the pipeline removed from the model output, for auditing. */
  provenanceNotes: string[];
};

/**
 * Upgrade any stored brief (v1 or v2) to the current shape. v1 briefs were
 * written before provenance existed: their facts keep working, marked "legacy".
 */
export function normalizeBrief(raw: unknown): Brief | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, any>;
  if (b.briefVersion === BRIEF_VERSION) return b as Brief;
  const facts: BriefFact[] = Array.isArray(b.facts)
    ? b.facts.map((f: any, i: number) => ({
        id: typeof f.id === "string" ? f.id : `fact_${String(i + 1).padStart(2, "0")}`,
        type: FactTypeSchema.safeParse(f.type).success ? f.type : "memory",
        text: String(f.text ?? ""),
        priority: clampPriority(f.priority),
        sourceQuote: typeof f.sourceQuote === "string" ? f.sourceQuote : "",
        sourceRef: f.sourceRef ?? null,
        provenance: (f.provenance as Provenance) ?? "legacy",
        emotionalMeaning: typeof f.emotionalMeaning === "string" ? f.emotionalMeaning : "",
        narrativeRole: NarrativeRoleSchema.safeParse(f.narrativeRole).success ? f.narrativeRole : "relationship_evidence",
      }))
    : [];
  const r = (b.recipient ?? {}) as Record<string, any>;
  return {
    briefVersion: BRIEF_VERSION,
    recipient: {
      name: String(r.name ?? ""),
      sungAs: String(r.sungAs ?? ""),
      relationship: String(r.relationship ?? ""),
      pronouns: r.pronouns === "she" || r.pronouns === "he" ? r.pronouns : "they",
      nicknames: Array.isArray(r.nicknames) ? r.nicknames.map(String) : [],
    },
    giverName: String(b.giverName ?? ""),
    occasion: String(b.occasion ?? ""),
    facts,
    omittedFacts: Array.isArray(b.omittedFacts) ? b.omittedFacts : [],
    emotionalThesis: String(b.emotionalThesis ?? b.summary ?? ""),
    signaturePhrases: Array.isArray(b.signaturePhrases) ? b.signaturePhrases : [],
    narrativeArc: Array.isArray(b.narrativeArc) ? b.narrativeArc.map(String) : [],
    contradictions: Array.isArray(b.contradictions) ? b.contradictions : [],
    tone: Array.isArray(b.tone) ? b.tone.map(String) : [],
    mustInclude: Array.isArray(b.mustInclude) ? b.mustInclude.map(String) : [],
    avoid: Array.isArray(b.avoid) ? b.avoid.map(String) : [],
    summary: String(b.summary ?? ""),
    followUpQuestions: Array.isArray(b.followUpQuestions) ? b.followUpQuestions.map(String) : [],
    provenanceNotes: Array.isArray(b.provenanceNotes) ? b.provenanceNotes.map(String) : [],
  };
}

export function clampPriority(p: unknown): 1 | 2 | 3 {
  const n = Math.round(Number(p));
  return n <= 1 ? 1 : n >= 3 ? 3 : 2;
}

/* -------------------------------------------------------------------------- */
/* Lyrics                                                                      */
/* -------------------------------------------------------------------------- */

export const SongPlanSchema = z.object({
  thesis: z.string().describe("The central emotional message, in one sentence."),
  centralDetail: z.string().describe("The single most compelling personal detail (by fact id and a few words)."),
  payoff: z.string().describe("What the listener should feel at the end."),
  hookConcept: z.string().describe("The chorus idea in one line, before writing it."),
  verseRoles: z.array(z.string()).describe("One short purpose per verse/bridge, in order."),
  ending: z.string().describe("How the song resolves or calls back."),
});

export const LyricsSchema = z.object({
  plan: SongPlanSchema,
  arrangementId: z.string().describe("The arrangement you chose, from the allowed list."),
  title: z.string().describe("Song title, at most 60 characters. Usually includes the name or the hook."),
  sections: z
    .array(
      z.object({
        tag: z.string().describe("Section tag exactly as the arrangement lists it, e.g. 'Verse 1', 'Chorus', 'Bridge', 'Outro'."),
        lines: z.array(z.string()).describe("Lyric lines. No tags, notes or parentheses inside lines."),
      }),
    )
    .describe("Every section in order. Write each chorus out in full every time it appears."),
  factPlacement: z
    .array(z.object({ factId: z.string(), line: z.string().describe("The exact lyric line that carries the fact.") }))
    .describe("For each brief fact used, its id and the exact line that carries it."),
  namePlacementNote: z
    .string()
    .describe("Empty string, unless the name is deliberately NOT in the first two chorus lines; then one sentence explaining why it reads better elsewhere in the chorus."),
});
export type Lyrics = z.infer<typeof LyricsSchema>;
export type SongPlan = z.infer<typeof SongPlanSchema>;

/** The original (v1) writer contract, kept so the old writer can be A/B tested. */
export const LyricsV1Schema = z.object({
  title: z.string(),
  sections: z.array(z.object({ tag: z.string(), lines: z.array(z.string()) })),
  factPlacement: z.array(z.object({ fact: z.string(), line: z.string() })),
});

/* -------------------------------------------------------------------------- */
/* Verifier                                                                    */
/* -------------------------------------------------------------------------- */

const ScoreSchema = z.object({
  score: z.number().int().describe("1 (poor) to 10 (excellent)."),
  why: z.string().describe("One sentence."),
});

export const IssueCategorySchema = z.enum(["factual", "constraint", "structure", "craft"]);
export const IssueSeveritySchema = z.enum(["critical", "warning", "suggestion"]);

export const VerifierReportSchema = z.object({
  factual: z.object({
    pass: z.boolean().describe("True only when nothing is invented, identity and relationship are right, constraints are respected and every priority-1 fact is present."),
    coverage: z.array(
      z.object({ factId: z.string(), covered: z.boolean(), evidence: z.string().describe("The line that carries it, or empty string.") }),
    ),
    inventedDetails: z
      .array(z.object({ section: z.string(), line: z.string(), claim: z.string() }))
      .describe("Specific claims (events, places, dates, hobbies, people, dialogue) NOT supported by the brief. Generic imagery and emotional interpretation are not inventions."),
    identityOk: z.boolean().describe("Recipient name and pronouns are right."),
    relationshipOk: z.boolean().describe("Nothing contradicts the relationship (e.g. romance in a song for a parent)."),
    constraintViolations: z.array(z.object({ constraint: z.string(), section: z.string(), line: z.string() })),
  }),
  issues: z.array(
    z.object({
      category: IssueCategorySchema,
      severity: IssueSeveritySchema,
      section: z.string(),
      line: z.string().describe("The exact line, or empty string if the issue is section-wide."),
      reason: z.string(),
      repair: z.string().describe("A concrete fix: what to change and what to keep."),
      requiresRewrite: z.boolean().describe("True only if the whole song needs rewriting rather than this section."),
    }),
  ),
  scores: z.object({
    emotionalImpact: ScoreSchema,
    personalSpecificity: ScoreSchema,
    hookMemorability: ScoreSchema,
    singability: ScoreSchema,
    genreFit: ScoreSchema,
  }),
  sectionsToRepair: z.array(z.string()).describe("Section tags that need changes. Empty if none."),
  summary: z.string(),
});
export type VerifierReport = z.infer<typeof VerifierReportSchema>;

export const CREATIVE_WEIGHTS = {
  emotionalImpact: 0.3,
  personalSpecificity: 0.25,
  hookMemorability: 0.2,
  singability: 0.15,
  genreFit: 0.1,
} as const;

/** Experimental weighted creative score, 1-10. Never overrides factual correctness. */
export function weightedCreativeScore(scores: VerifierReport["scores"]): number {
  let total = 0;
  for (const [k, w] of Object.entries(CREATIVE_WEIGHTS)) {
    const s = Math.max(1, Math.min(10, Number((scores as Record<string, { score: number }>)[k]?.score ?? 5)));
    total += s * w;
  }
  return Math.round(total * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Quiz                                                                        */
/* -------------------------------------------------------------------------- */

export type QuizInput = {
  recipientName: string | null;
  pronunciation: string | null;
  relationship: string;
  occasion: string;
  story: string;
  genreKey: string;
  vocalGender: "m" | "f" | "any";
  mood: string | null;
  customStyle: string | null;
  followUpAnswers?: Record<string, string> | null;
};

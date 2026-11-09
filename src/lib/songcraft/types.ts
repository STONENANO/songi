import { z } from "zod/v4";

/**
 * The structured brief is the single source of truth for everything downstream.
 * Lyrics are written from the brief, never from the raw story, and the verifier
 * checks lyrics against the brief. No optional fields: structured outputs
 * are strict, so "nothing" is an empty string or empty array.
 */
export const FactTypeSchema = z.enum(["memory", "trait", "place", "inside_joke", "relationship", "wish"]);

export const BriefSchema = z.object({
  recipient: z.object({
    name: z.string().describe("First name or nickname to sing. Empty string if the giver gave none."),
    sungAs: z
      .string()
      .describe(
        "Phonetic respelling for singing ONLY if the name is likely to be mispronounced (e.g. 'Siobhan' -> 'Shiv-awn'). Otherwise empty string.",
      ),
    relationship: z.string().describe("Who the recipient is to the giver, e.g. 'mom', 'girlfriend', 'best friend'."),
    pronouns: z.enum(["she", "he", "they"]).describe("Pronouns to use for the recipient."),
  }),
  giverName: z.string().describe("Name of the person giving the song, or empty string."),
  occasion: z.string().describe("The occasion, e.g. '60th birthday', 'anniversary', 'just because'."),
  facts: z
    .array(
      z.object({
        type: FactTypeSchema,
        text: z.string().describe("One concrete detail, rewritten as a short plain sentence. Never invent."),
        priority: z.number().int().min(1).max(3).describe("1 = must appear in the song, 3 = nice to have."),
      }),
    )
    .describe("Every real detail the giver shared. Between 0 and 10 items."),
  tone: z.array(z.string()).describe("2 to 4 adjectives, e.g. ['warm', 'funny', 'grateful']."),
  mustInclude: z.array(z.string()).describe("Exact words or phrases that must appear in the lyrics (names, nicknames, inside jokes)."),
  avoid: z.array(z.string()).describe("Topics or words to steer clear of, inferred from relationship and story. E.g. romance for a parent."),
  summary: z.string().describe("One sentence describing what this song is about, for the giver to confirm."),
  followUpQuestions: z
    .array(z.string())
    .describe(
      "0 to 2 short, warm questions to ask the giver ONLY if the story is too thin to write a personal song (fewer than 3 usable facts). Empty array otherwise.",
    ),
});
export type Brief = z.infer<typeof BriefSchema>;

export const LyricsSchema = z.object({
  title: z.string().describe("Song title, max 60 characters, usually includes the recipient's name."),
  sections: z
    .array(
      z.object({
        tag: z.string().describe("Section tag exactly as the blueprint lists it, e.g. 'Verse 1', 'Chorus', 'Bridge', 'Outro'."),
        lines: z.array(z.string()).describe("The lyric lines for this section. No tags inside lines."),
      }),
    )
    .describe("Sections in the exact order of the blueprint."),
  factPlacement: z
    .array(z.object({ fact: z.string(), line: z.string() }))
    .describe("For each brief fact used, the lyric line that carries it. Used for self-checking."),
});
export type Lyrics = z.infer<typeof LyricsSchema>;

export const VerifierReportSchema = z.object({
  pass: z.boolean().describe("True only if there are no 'error' severity issues."),
  factCoverage: z.array(
    z.object({
      fact: z.string(),
      covered: z.boolean(),
      evidence: z.string().describe("The lyric line that covers it, or empty string."),
    }),
  ),
  inventedDetails: z.array(z.string()).describe("Specific claims in the lyrics that are NOT in the brief. Generic imagery is fine; invented facts are not."),
  nameInChorus: z.boolean(),
  issues: z.array(
    z.object({
      severity: z.enum(["error", "warning"]),
      message: z.string(),
    }),
  ),
  repairInstructions: z.string().describe("Concrete instructions to fix the errors, or empty string if pass."),
});
export type VerifierReport = z.infer<typeof VerifierReportSchema>;

/** Raw quiz input, the only thing the giver types. */
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

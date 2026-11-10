/**
 * Step 1 of songcraft: turn raw quiz answers into a structured, source-backed
 * brief. One Claude call extracts facts with the customer's exact supporting
 * words; code then verifies every quote, deduplicates, ranks and caps the facts
 * (see provenance.ts). If the story is too thin, up to two follow-up questions
 * are asked, never more than once.
 */
import { structured, recordMockCall } from "../llm/client";
import { env } from "../env";
import { BriefLLMSchema, type Brief, type QuizInput } from "./types";
import { mockBriefLLM } from "./mock";
import { buildSourceBackedBrief } from "./provenance";

export const BRIEF_SYSTEM = `You are the intake producer for a custom gift-song studio. A customer has answered a short quiz about someone they love. Turn their answers into a structured brief that a songwriter will write from. The songwriter never sees the raw story, so the brief must carry both the facts and the customer's own voice.

Facts
- Use ONLY what the customer actually wrote. Never invent, embellish or assume. "She loves gardening" is the fact "loves gardening", not "spends Sundays in her rose garden".
- Write each fact as one short, plain sentence. Keep names, places, numbers and specific nouns exactly as given.
- sourceQuote: copy the customer's exact words that support the fact, character for character, from the story or a follow-up answer. Never paraphrase or tidy it. The pipeline checks every quote against the original text and drops facts it cannot trace.
- emotionalMeaning: what the detail says about the relationship, in a few words. This is interpretation for the songwriter, never a new event.
- narrativeRole: where the detail would serve the song best. closing_callback means a detail worth planting early and echoing at the end, not a detail saved for the last line.
- Priority 1 for the 2 to 4 most personal, specific details (memories, inside jokes, named places, things only these two people share). Generic traits ("kind", "always there") are priority 2 or 3.

Voice
- signaturePhrases: the customer's memorable wording: sayings, inside jokes, nicknames, quotes, unusual expressions. Exact spelling. Only phrases that appear in what they wrote.
- emotionalThesis: one sentence on what this song is really trying to say, grounded in the story. It guides the song; it is not a lyric.
- narrativeArc: 3 to 5 beats for how the song could unfold, using this story's real material.

Safety and accuracy
- The recipient's name is the name the song will sing. Put a pronunciation hint in sungAs if given; for an unusual name that a singer would likely get wrong, write a simple phonetic respelling. Leave sungAs empty for common names.
- Pronouns come from the relationship and story; use "they" if unclear and list the ambiguity in contradictions.
- contradictions: list conflicting or uncertain details (two different names, conflicting ages, unclear pronouns). Do not resolve them.
- avoid: for a parent, grandparent, child, friend or coworker include "romantic language". Add anything the customer asked to leave out.
- mustInclude: only the name, nicknames, and inside-joke words the customer clearly wants sung, exactly as written. Never ordinary topic words (places, foods, activities): those belong in facts, where the songwriter can phrase them freely.
- Never include anything sexual, hateful or about illegal activity in facts. Drop it and add it to avoid.

Follow-up questions
- Ask 1 or 2 short, warm questions ONLY when there are fewer than 3 usable facts or the story is entirely generic ("she's the best mom ever"). Ask for a specific memory, a habit, a place, or an inside joke.
- If follow-up answers are already included, never ask again: return an empty array.

summary: one friendly sentence the customer will see, e.g. "A warm country song for your mom Linda about Sunday pancakes, the lake house, and her off-key car singing."`;

export async function extractBrief(input: QuizInput): Promise<Brief> {
  let llm;
  if (env.mockLlm) {
    recordMockCall("brief");
    llm = mockBriefLLM(input);
  } else {
    const answers = input.followUpAnswers
      ? Object.entries(input.followUpAnswers)
          .map(([q, a]) => `Q: ${q}\nA: ${a}`)
          .join("\n\n")
      : "";
    const user = [
      `Recipient name: ${input.recipientName?.trim() || "(not given)"}`,
      `Pronunciation hint: ${input.pronunciation?.trim() || "(none)"}`,
      `Relationship to customer: ${input.relationship}`,
      `Occasion: ${input.occasion.replace(/_/g, " ")}`,
      `Requested mood: ${input.mood ?? "(none)"}`,
      `Genre: ${input.genreKey}`,
      ``,
      `The customer's story, verbatim:`,
      `"""`,
      input.story.trim(),
      `"""`,
      answers ? `\nFollow-up questions already answered (do not ask more):\n${answers}` : "",
    ].join("\n");
    ({ output: llm } = await structured({ operation: "brief", schema: BriefLLMSchema, system: BRIEF_SYSTEM, user, effort: "medium", maxTokens: 8000 }));
  }

  const brief = buildSourceBackedBrief(llm, {
    story: input.story,
    followUpAnswers: input.followUpAnswers,
    recipientName: input.recipientName,
    pronunciation: input.pronunciation,
    relationship: input.relationship,
    factCap: env.briefFactCap,
  });
  // Hard guarantees regardless of what the model did: never ask twice, never more than two.
  if (input.followUpAnswers) brief.followUpQuestions = [];
  brief.followUpQuestions = brief.followUpQuestions.slice(0, 2);
  return brief;
}

/**
 * Step 1 of songcraft: turn raw quiz answers into a structured brief.
 * "Agentic" in the sense that the model decides whether it has enough to
 * write a personal song and, if not, asks up to two follow-up questions.
 */
import { structured } from "../llm/client";
import { env } from "../env";
import { BriefSchema, type Brief, type QuizInput } from "./types";
import { mockBrief } from "./mock";

const SYSTEM = `You are the intake producer for a custom gift-song studio. A customer has answered a short quiz about someone they love. Your job is to turn their answers into a structured brief that a lyricist will write from.

Rules:
- Use ONLY facts the customer actually wrote. Never invent, embellish, or assume details. If the customer says "she loves gardening", the fact is "loves gardening", not "spends every Sunday in her rose garden".
- Rewrite each fact as one short, plain, singable sentence. Keep names, places, and specific nouns exactly as given.
- Mark priority 1 for the 2 to 4 most personal, specific facts (memories, inside jokes, named places). Generic traits are priority 2 or 3.
- The recipient's name is the name the song will sing. If the customer gave a pronunciation hint, put it in sungAs. If the name is unusual and likely to be mispronounced by a singer, write a simple phonetic respelling in sungAs. For common names leave sungAs empty.
- Infer pronouns from the relationship and story. Default to "they" if unclear.
- The avoid list protects against tonal mistakes: for a parent, grandparent, child, friend, or coworker add "romantic language". Add anything the customer asked to leave out.
- followUpQuestions: ask 1 or 2 short, warm questions ONLY when there are fewer than 3 usable facts, or when the story is entirely generic ("she's the best mom ever"). Ask for a specific memory, a habit, a place, or an inside joke. If the customer has already answered follow-up questions, never ask more: return an empty array.
- summary: one friendly sentence the customer will see, e.g. "A warm country song for your mom Linda about Sunday pancakes, the lake house, and her off-key car singing."
- Never include anything sexual, hateful, or about illegal activity in facts. Drop it silently and add it to avoid.`;

/** Drop duplicate facts (same text, case-insensitive), keeping the higher priority. */
function dedupeFacts(brief: Brief): Brief {
  const seen = new Map<string, Brief["facts"][number]>();
  for (const f of brief.facts) {
    const key = f.text.trim().toLowerCase().replace(/[.!?]$/, "");
    const prev = seen.get(key);
    if (!prev || f.priority < prev.priority) seen.set(key, f);
  }
  return { ...brief, facts: [...seen.values()].slice(0, 10) };
}

export async function extractBrief(input: QuizInput): Promise<Brief> {
  if (env.mockLlm) return dedupeFacts(mockBrief(input));

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
    answers ? `\nFollow-up questions already answered:\n${answers}` : "",
  ].join("\n");

  const { output } = await structured({ schema: BriefSchema, system: SYSTEM, user, effort: "medium", maxTokens: 4000 });

  // Hard guarantees regardless of what the model did.
  if (input.followUpAnswers) output.followUpQuestions = [];
  output.followUpQuestions = output.followUpQuestions.slice(0, 2);
  if (!output.recipient.name && input.recipientName) output.recipient.name = input.recipientName.trim();
  if (input.pronunciation?.trim()) output.recipient.sungAs = input.pronunciation.trim();
  return dedupeFacts(output);
}

/**
 * The in-quiz "dig deeper" step. After each story answer, a fast model reacts
 * to it, pulls out short song ingredients, and asks one follow-up only when
 * the answer lacks a concrete moment. Interactive, so it must be quick and
 * must never block the quiz: callers treat any failure as "no follow-up".
 */
import { z } from "zod/v4";
import { structured } from "../llm/client";
import { env } from "../env";

export const ProbeSchema = z.object({
  reaction: z.string().describe("A warm reaction of at most 12 words that echoes one specific word or detail from the answer. No exclamation-mark spam."),
  followUp: z
    .string()
    .describe("ONE short follow-up question (max 18 words) asking for a concrete moment, image, or exact words. Empty string if the answer already has a specific moment or 3+ concrete details."),
  ingredients: z
    .array(z.string())
    .describe("1 to 4 song ingredients: short phrases (2 to 5 words) lifted from the answer. Never invent anything not in the answer."),
});
export type Probe = z.infer<typeof ProbeSchema>;

export type ProbeInput = {
  recipientName: string;
  relationship: string;
  pronoun: "she" | "he" | "they";
  question: string;
  answer: string;
  /** True when this answer is itself a reply to an earlier follow-up. Never ask another. */
  isFollowUp: boolean;
  fallbackDig: string;
};

const SYSTEM = `You help a customer tell a story about someone they love so a songwriter can write a personal song for them. You are warm, brief, and specific, like a good interviewer. You speak as "we".

You receive one question and the customer's answer. Return:
- reaction: echo one specific detail they gave, at most 12 words. Never generic praise like "great answer".
- followUp: only if the answer is vague (adjectives with no moment, e.g. "she's caring and supportive") ask ONE question that pulls a concrete scene, sensory detail, or exact words. Use the recipient's name. If the answer already contains a specific moment, place, or quote, return an empty string.
- ingredients: 1 to 4 short phrases taken from the answer that could become lyrics. Never invent details.

Never ask about anything sexual, medical, or financial. If the answer mentions loss or grief, be gentle and do not ask a follow-up.`;

export async function probeAnswer(input: ProbeInput): Promise<Probe> {
  if (env.mockLlm) return mockProbe(input);
  const user = [
    `Recipient: ${input.recipientName || "(no name)"} (${input.relationship}, pronoun ${input.pronoun})`,
    `Question: ${input.question}`,
    `Answer: """${input.answer.trim()}"""`,
    input.isFollowUp ? `This answer is already a reply to a follow-up. followUp MUST be an empty string.` : "",
  ].join("\n");
  const { output } = await structured({ schema: ProbeSchema, system: SYSTEM, user, model: env.probeModel, effort: null, maxTokens: 400 });
  if (input.isFollowUp) output.followUp = "";
  output.ingredients = output.ingredients.map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return output;
}

const REACTIONS = ["We can already hear this one.", "That's a detail worth singing.", "That's going in the song.", "Love that. Very specific, very them."];

/** Deterministic stand-in so the quiz works with no API key. */
export function mockProbe(input: ProbeInput): Probe {
  const clauses = input.answer
    .split(/[.,;!?\n]+|\band\b|\bbut\b/i)
    .map((s) => s.trim().split(/\s+/).slice(0, 5).join(" "))
    .filter((s) => s.split(" ").length >= 2);
  const thin = input.answer.trim().length < 80;
  return {
    reaction: REACTIONS[input.answer.length % REACTIONS.length],
    followUp: thin && !input.isFollowUp ? input.fallbackDig : "",
    ingredients: clauses.slice(0, 3),
  };
}

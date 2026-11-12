import { z } from "zod/v4";

/** One answered story question, as the quiz sends it. */
export const StoryAnswerSchema = z.object({
  thread: z.string().max(40),
  question: z.string().max(300),
  answer: z.string().trim().max(2000),
  followUp: z.string().max(300).optional().default(""),
  followUpAnswer: z.string().trim().max(2000).optional().default(""),
});
export type StoryAnswer = z.infer<typeof StoryAnswerSchema>;

/**
 * Turn structured answers into the plain-text story the brief extractor reads.
 * Questions are kept so the model knows what each answer is about.
 */
export function composeStory(answers: StoryAnswer[], oneLine: string): string {
  const blocks = answers
    .filter((a) => a.answer.trim())
    .map((a) => {
      const lines = [`Q: ${a.question}`, `A: ${a.answer.trim()}`];
      if (a.followUp && a.followUpAnswer.trim()) lines.push(`Q: ${a.followUp}`, `A: ${a.followUpAnswer.trim()}`);
      return lines.join("\n");
    });
  if (oneLine.trim()) blocks.push(`What I most want the song to say: ${oneLine.trim()}`);
  return blocks.join("\n\n").slice(0, 4000);
}

/**
 * Thin wrapper around the Anthropic SDK for structured (JSON) calls.
 * Every songcraft step goes through `structured()` so model, effort,
 * refusal handling and cost logging live in one place.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";
import { env } from "../env";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

export class LlmRefusalError extends Error {
  constructor(public category: string | null, explanation: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}: ${explanation ?? ""}`);
    this.name = "LlmRefusalError";
  }
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type StructuredResult<T> = {
  output: T;
  usage: { inputTokens: number; outputTokens: number; cacheRead: number };
};

/**
 * Ask Claude for a response that validates against `schema`.
 * System prompts are cached: keep them stable and put volatile text in `user`.
 */
export async function structured<S extends z.ZodTypeAny>(opts: {
  schema: S;
  system: string;
  user: string;
  effort?: Effort;
  maxTokens?: number;
}): Promise<StructuredResult<z.infer<S>>> {
  const anthropic = getClient();
  const response = await anthropic.messages.parse({
    model: env.llmModel,
    max_tokens: opts.maxTokens ?? 8000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: opts.effort ?? "medium", format: zodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.user }],
  });

  if (response.stop_reason === "refusal") {
    throw new LlmRefusalError(
      response.stop_details?.category ?? null,
      response.stop_details?.explanation ?? null,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Model output was cut off (max_tokens). Increase maxTokens.");
  }
  if (!response.parsed_output) {
    throw new Error("Model returned output that did not match the schema.");
  }
  return {
    output: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

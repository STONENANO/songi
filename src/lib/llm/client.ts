/**
 * Thin wrapper around the Anthropic SDK for structured (JSON) calls.
 * Every songcraft step goes through `structured()` so model, effort,
 * refusal handling, fallbacks and usage accounting live in one place.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
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

export type LlmUsage = {
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  /** Estimate from configurable per-token rates; not an invoiced amount. */
  estCostUsd: number;
  mock: boolean;
};

/* ---------------------- usage accounting (per request) ---------------------- */

type UsageScope = { records: LlmUsage[] };
const scope = new AsyncLocalStorage<UsageScope>();

/** Run `fn` and collect every LLM call made inside it (including mocked ones). */
export async function withUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: LlmUsage[] }> {
  const s: UsageScope = { records: [] };
  const result = await scope.run(s, fn);
  return { result, usage: s.records };
}

export function recordUsage(u: LlmUsage): void {
  scope.getStore()?.records.push(u);
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return Math.round(((inputTokens * env.llmInputCostPerMTok + outputTokens * env.llmOutputCostPerMTok) / 1_000_000) * 10000) / 10000;
}

/** Mocked calls still count as calls so cost/call metrics stay comparable across modes. */
export function recordMockCall(operation: string): void {
  recordUsage({ operation, model: "mock", inputTokens: 0, outputTokens: 0, cacheRead: 0, estCostUsd: 0, mock: true });
}

export type StructuredResult<T> = { output: T; usage: LlmUsage };

/**
 * Ask Claude for a response that validates against `schema`.
 * System prompts are cached: keep them stable and put volatile text in `user`.
 */
export async function structured<S extends z.ZodType>(opts: {
  operation: string;
  schema: S;
  system: string;
  user: string;
  /** Pass null to omit the effort setting (for models that do not support it). */
  effort?: Effort | null;
  maxTokens?: number;
  /** Override the default model, e.g. a fast model for interactive calls. */
  model?: string;
}): Promise<StructuredResult<z.infer<S>>> {
  // A response that doesn't match the schema (e.g. a value outside an allowed list) is rare and
  // usually doesn't repeat: ask once more before failing the whole song.
  for (let attempt = 1; ; attempt++) {
    try {
      return await structuredOnce(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const schemaMiss = /Failed to parse structured output|did not match the schema/i.test(msg);
      if (!schemaMiss || attempt >= 2) throw e;
      console.warn(`[llm] ${opts.operation}: output did not match the schema, retrying once:`, msg.slice(0, 300));
    }
  }
}

async function structuredOnce<S extends z.ZodType>(opts: Parameters<typeof structured<S>>[0]): Promise<StructuredResult<z.infer<S>>> {
  const anthropic = getClient();
  // Streamed: large outputs (lyrics with adaptive thinking) exceed the SDK's non-streaming limit.
  // finalMessage() still returns the complete, schema-parsed response.
  const stream = anthropic.beta.messages.stream({
    model: opts.model ?? env.llmModel,
    max_tokens: opts.maxTokens ?? 16000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    output_config: { ...(opts.effort === null ? {} : { effort: opts.effort ?? "medium" }), format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.user }],
    ...(env.llmRefusalFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new LlmRefusalError(response.stop_details?.category ?? null, response.stop_details?.explanation ?? null);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(`${opts.operation}: model output was cut off (max_tokens). Increase maxTokens.`);
  }
  if (!response.parsed_output) {
    throw new Error(`${opts.operation}: model returned output that did not match the schema.`);
  }
  const usage: LlmUsage = {
    operation: opts.operation,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    estCostUsd: estimateCost(response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) * 0.1, response.usage.output_tokens),
    mock: false,
  };
  recordUsage(usage);
  return { output: response.parsed_output as z.infer<S>, usage };
}

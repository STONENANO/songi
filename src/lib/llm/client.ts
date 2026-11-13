/**
 * Thin wrapper around the Anthropic SDK for structured (JSON) calls.
 * Every songcraft step goes through `structured()` so model, effort,
 * refusal handling, fallbacks and usage accounting live in one place.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Anthropic as PostHogAnthropic } from "@posthog/ai/anthropic";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PostHog } from "posthog-node";
import type { z } from "zod/v4";
import { env } from "../env";

let anthropicClient: Anthropic | null = null;
let observedAnthropicClient: PostHogAnthropic | null = null;
let posthogClient: PostHog | null | undefined;

function getPostHogClient(): PostHog | null {
  if (posthogClient !== undefined) return posthogClient;

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!token || !host) {
    if (process.env.NODE_ENV !== "production") {
      const missing = token ? "NEXT_PUBLIC_POSTHOG_HOST" : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
      console.warn(`${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`);
    }
    posthogClient = null;
    return posthogClient;
  }

  posthogClient = new PostHog(token, {
    host,
    privacyMode: false,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 2000,
    fetchRetryCount: 0,
  });
  return posthogClient;
}

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: env.anthropicApiKey });
  return anthropicClient;
}

function getObservedAnthropicClient(posthog: PostHog): PostHogAnthropic {
  if (!observedAnthropicClient) observedAnthropicClient = new PostHogAnthropic({ apiKey: env.anthropicApiKey, posthog });
  return observedAnthropicClient;
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
type AiScope = { sessionId: string; traceId: string; capture: boolean };
const scope = new AsyncLocalStorage<UsageScope>();
const aiScope = new AsyncLocalStorage<AiScope>();
const processSessionId = `process-${crypto.randomUUID()}`;

type UsageResult<T> = Promise<{ result: T; usage: LlmUsage[] }>;

/** Run one production song-processing turn and collect every LLM call made inside it (including mocked ones). */
export function withUsage<T>(songRequestId: string, fn: () => Promise<T>): UsageResult<T>;
/** Legacy local evaluation and test helper: preserves usage accounting without AI Observability capture. */
export function withUsage<T>(fn: () => Promise<T>): UsageResult<T>;
export async function withUsage<T>(songRequestIdOrFn: string | (() => Promise<T>), maybeFn?: () => Promise<T>): UsageResult<T> {
  const capture = typeof songRequestIdOrFn === "string";
  const fn = capture ? maybeFn : songRequestIdOrFn;
  if (!fn) throw new Error("withUsage requires a function");

  const s: UsageScope = { records: [] };
  const ai: AiScope = {
    sessionId: capture ? `song-${songRequestIdOrFn}` : processSessionId,
    traceId: crypto.randomUUID(),
    capture,
  };
  const result = await aiScope.run(ai, () => scope.run(s, fn));
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
  const run = async () => {
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
  };

  if (aiScope.getStore()) return run();
  return aiScope.run({ sessionId: processSessionId, traceId: crypto.randomUUID(), capture: true }, run);
}

async function structuredOnce<S extends z.ZodType>(opts: Parameters<typeof structured<S>>[0]): Promise<StructuredResult<z.infer<S>>> {
  // Streamed: large outputs (lyrics with adaptive thinking) exceed the SDK's non-streaming limit.
  // finalMessage() still returns the complete, schema-parsed response.
  const request = {
    model: opts.model ?? env.llmModel,
    max_tokens: opts.maxTokens ?? 16000,
    system: [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }],
    output_config: { ...(opts.effort === null ? {} : { effort: opts.effort ?? "medium" }), format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user" as const, content: opts.user }],
    ...(env.llmRefusalFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
  const ai = aiScope.getStore();
  const posthog = ai?.capture === false ? null : getPostHogClient();
  const stream = posthog
    ? getObservedAnthropicClient(posthog).beta.messages.stream({
        ...request,
        posthogTraceId: ai?.traceId ?? crypto.randomUUID(),
        posthogProperties: { $ai_session_id: ai?.sessionId ?? processSessionId },
      })
    : getAnthropicClient().beta.messages.stream(request);

  let response;
  try {
    response = await stream.finalMessage();
  } finally {
    // Route handlers and Next.js after() work can end before the background queue sends.
    // A short, handled flush preserves the successful Anthropic response when PostHog is unavailable.
    await posthog?.flush().catch(() => {});
  }

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

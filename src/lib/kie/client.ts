/**
 * Kie.ai client for the Suno music endpoints, via the unified jobs API:
 *   POST /api/v1/jobs/createTask    GET /api/v1/jobs/recordInfo
 *
 * Paid-call safety: task creation is never retried after the request may have
 * reached Kie.ai (timeouts, gateway errors, malformed replies). Those raise
 * AmbiguousSubmitError and the pipeline reconciles via the callback, which
 * carries our own generation id. Only failures that provably created no task
 * (connection refused, explicit rate-limit or validation codes) are retried.
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod/v4";
import { env } from "../env";
import { KieTrackSchema, type KieAlignedWord, type KieTaskStatus, type KieTrack } from "./types";
import type { KieMusicInput } from "../songcraft/style";
import { makeTestTone, run } from "../audio/ffmpeg";

const BASE = "https://api.kie.ai";

export class KieError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly code?: number) {
    super(message);
    this.name = "KieError";
  }
}
/** The request may or may not have created a (billed) task. Do not resubmit blindly. */
export class AmbiguousSubmitError extends KieError {
  constructor(message: string) {
    super(message, false);
    this.name = "AmbiguousSubmitError";
  }
}

const RETRYABLE_CODES = new Set([405, 429, 430, 455, 500, 505]);
const ENVELOPE = z.object({ code: z.number(), msg: z.string().optional().default(""), data: z.unknown() });

type FetchOpts = { method: "GET" | "POST"; body?: unknown; timeoutMs?: number; paid?: boolean };

async function kieFetch(pathname: string, o: FetchOpts): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: o.method,
      headers: { Authorization: `Bearer ${env.kieApiKey}`, "Content-Type": "application/json" },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const notSent = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(err.cause?.code ?? "");
    if (o.paid && !notSent) throw new AmbiguousSubmitError(`Kie.ai ${pathname}: ${err.name === "TimeoutError" ? "timed out" : err.message} after the request may have been sent.`);
    throw new KieError(`Kie.ai ${pathname}: ${err.message}`, true);
  }
  const raw = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    if (o.paid) throw new AmbiguousSubmitError(`Kie.ai ${pathname}: HTTP ${res.status} with a non-JSON body.`);
    throw new KieError(`Kie.ai ${pathname}: HTTP ${res.status} with a non-JSON body.`, res.status >= 500);
  }
  const env_ = ENVELOPE.safeParse(json);
  if (!env_.success) {
    if (o.paid) throw new AmbiguousSubmitError(`Kie.ai ${pathname}: unexpected response shape.`);
    throw new KieError(`Kie.ai ${pathname}: unexpected response shape.`, false);
  }
  if (!res.ok && res.status >= 500 && o.paid) throw new AmbiguousSubmitError(`Kie.ai ${pathname}: HTTP ${res.status}.`);
  if (env_.data.code !== 200) {
    throw new KieError(`Kie.ai ${pathname}: code ${env_.data.code}: ${env_.data.msg}`, RETRYABLE_CODES.has(env_.data.code), env_.data.code);
  }
  return env_.data.data;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof AmbiguousSubmitError || !(e instanceof KieError) || !e.retryable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

/** Signed callback URL bound to one generation, so callbacks can be routed and reconciled. */
export function callbackUrl(generationId: string): string {
  const sig = crypto.createHmac("sha256", env.kieWebhookSecret).update(generationId).digest("hex").slice(0, 32);
  return `${env.appUrl}/api/webhooks/kie?gid=${generationId}&sig=${sig}`;
}

export function verifyCallbackParams(generationId: string | null, sig: string | null): boolean {
  if (!generationId || !sig) return false;
  const expected = crypto.createHmac("sha256", env.kieWebhookSecret).update(generationId).digest("hex").slice(0, 32);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** Kie.ai's documented webhook signature: base64(HMAC-SHA256(taskId + "." + timestamp, webhookHmacKey)). */
export function verifyKieSignature(taskId: string, timestamp: string | null, signature: string | null, key: string, nowSec = Math.floor(Date.now() / 1000), maxSkewSec = 600): boolean {
  if (!timestamp || !signature || !key) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > maxSkewSec) return false;
  const expected = crypto.createHmac("sha256", key).update(`${taskId}.${timestamp}`).digest("base64");
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function createMusicTask(input: KieMusicInput, cbUrl: string): Promise<string> {
  if (env.mockKie) return mock.create(input);
  const data = await withRetry(() => kieFetch("/api/v1/jobs/createTask", { method: "POST", body: { model: "ai-music-api/generate", callBackUrl: cbUrl, input }, paid: true, timeoutMs: 45_000 }));
  const parsed = z.object({ taskId: z.string().min(1) }).safeParse(data);
  if (!parsed.success) throw new AmbiguousSubmitError("Kie.ai accepted the request but returned no taskId.");
  return parsed.data.taskId;
}

/** Recursively collect track-like objects from whatever shape resultJson takes, validating each. */
export function extractTracks(node: unknown): { tracks: KieTrack[]; invalid: number } {
  const out: KieTrack[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const audio = o.audio_url ?? o.audioUrl ?? o.source_audio_url ?? o.sourceAudioUrl;
    if (typeof o.id === "string" && audio !== undefined) {
      const candidate = {
        id: o.id,
        audio_url: audio,
        stream_audio_url: o.stream_audio_url ?? o.streamAudioUrl,
        image_url: o.image_url ?? o.imageUrl,
        title: o.title,
        duration: typeof o.duration === "number" ? o.duration : undefined,
        tags: o.tags,
        model_name: o.model_name ?? o.modelName,
      };
      const p = KieTrackSchema.safeParse(JSON.parse(JSON.stringify(candidate)));
      if (p.success && !seen.has(p.data.id)) {
        seen.add(p.data.id);
        out.push(p.data);
      } else if (!p.success) invalid++;
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(node);
  return { tracks: out, invalid };
}

const RECORD = z
  .object({
    state: z.enum(["waiting", "queuing", "generating", "success", "fail"]).catch("generating"),
    resultJson: z.string().nullish(),
    response: z.unknown().optional(),
    failMsg: z.string().nullish(),
    creditsConsumed: z.number().nullish(),
  })
  .passthrough();

/** Authoritative task status. Callbacks are only triggers; results always come from here. */
export async function getTaskStatus(taskId: string): Promise<KieTaskStatus> {
  if (env.mockKie) return mock.status(taskId);
  const data = await withRetry(() => kieFetch(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { method: "GET" }));
  const rec = RECORD.parse(data);
  let parsed: unknown = rec.response ?? null;
  if (!parsed && rec.resultJson) {
    try {
      parsed = JSON.parse(rec.resultJson);
    } catch {
      parsed = null;
    }
  }
  const { tracks, invalid } = parsed ? extractTracks(parsed) : { tracks: [], invalid: 0 };
  return { state: rec.state, tracks, invalidTracks: invalid, failMsg: rec.failMsg ?? null, creditsConsumed: rec.creditsConsumed ?? null };
}

export async function getTimestampedLyrics(taskId: string, audioId: string): Promise<KieAlignedWord[]> {
  if (env.mockKie) return mock.aligned(taskId, audioId);
  const data = await withRetry(() => kieFetch("/api/v1/jobs/createTask", { method: "POST", body: { model: "ai-music-api/timeStamped-lyrics", input: { task_id: taskId, audio_id: audioId } } }));
  const inner = z.object({ code: z.number(), msg: z.string().optional(), data: z.object({ alignedWords: z.array(z.object({ word: z.string(), success: z.boolean(), startS: z.number(), endS: z.number(), palign: z.number().optional().default(0) })).optional() }).optional() }).safeParse(data);
  if (!inner.success || inner.data.code !== 200) throw new KieError(`Timestamped lyrics failed for ${audioId}.`, false);
  return (inner.data.data?.alignedWords ?? []).map((w) => ({ ...w, palign: w.palign ?? 0 }));
}

/* -------------------------------------------------------------------------- */
/* Safe audio URLs                                                             */
/* -------------------------------------------------------------------------- */

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[::1\]|\[fc|\[fd|::1$)/i;

/** Only public https URLs (or file:// produced by the mock) may be downloaded. */
export function assertSafeAudioUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new KieError(`Invalid audio URL.`, false);
  }
  if (u.protocol === "file:") {
    if (!env.mockKie) throw new KieError("file:// audio URLs are only allowed in mock mode.", false);
    return u;
  }
  if (u.protocol !== "https:") throw new KieError(`Audio URL must be https (got ${u.protocol}).`, false);
  if (u.username || u.password) throw new KieError("Audio URL must not carry credentials.", false);
  if (PRIVATE_HOST.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) throw new KieError(`Audio host ${u.hostname} is not allowed.`, false);
  if (env.kieAudioHosts.length && !env.kieAudioHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) throw new KieError(`Audio host ${u.hostname} is not in KIE_AUDIO_HOSTS.`, false);
  return u;
}

/* -------------------------------------------------------------------------- */
/* Mock implementation (no network, no cost)                                   */
/* -------------------------------------------------------------------------- */

export type MockTaskBehavior = {
  /** Number of tracks the task returns (default 2). */
  tracks?: number;
  /** Fail the whole task with this message. */
  fail?: string;
  /** Per-track audio kind. */
  kinds?: ("tone" | "silent" | "short" | "clipped" | "corrupt")[];
  /** Mark the task as succeeded but return no valid tracks. */
  empty?: boolean;
  /** Throw an ambiguous error from createMusicTask (simulates a lost response). */
  ambiguous?: boolean;
};

type MockTask = { createdAt: number; input: KieMusicInput; tracks: KieTrack[] | null; behavior: MockTaskBehavior };
const globalMock = globalThis as unknown as { __kieMock?: Map<string, MockTask>; __kieMockQueue?: MockTaskBehavior[]; __kieMockLast?: string };
const tasks = (globalMock.__kieMock ??= new Map<string, MockTask>());
const queue = (globalMock.__kieMockQueue ??= []);
const MOCK_DURATION = 120;

export const mockKieControl = {
  /** Queue behaviours for the next createMusicTask calls, in order. */
  queue(...b: MockTaskBehavior[]) {
    queue.push(...b);
  },
  reset() {
    queue.length = 0;
    tasks.clear();
  },
  get taskCount() {
    return tasks.size;
  },
  /** Id of the most recently created mock task (including one whose response was "lost"). */
  get lastTaskId() {
    return globalMock.__kieMockLast ?? null;
  },
  /** Register a task created elsewhere (used to simulate an ambiguous submit that did succeed). */
  adopt(taskId: string, input: KieMusicInput) {
    tasks.set(taskId, { createdAt: Date.now(), input, tracks: null, behavior: {} });
  },
};

async function makeMockAudio(file: string, kind: string, freq: number) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (kind === "silent") await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo`, "-t", String(MOCK_DURATION), "-codec:a", "libmp3lame", "-q:a", "6", file]);
  else if (kind === "short") await makeTestTone(file, 20, freq);
  else if (kind === "clipped") await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${MOCK_DURATION}`, "-af", "volume=30", "-codec:a", "libmp3lame", "-q:a", "6", file]);
  else if (kind === "corrupt") fs.writeFileSync(file, crypto.randomBytes(80_000));
  else await makeTestTone(file, MOCK_DURATION, freq);
}

const mock = {
  async create(input: KieMusicInput): Promise<string> {
    const behavior = queue.shift() ?? {};
    const taskId = `mock_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    tasks.set(taskId, { createdAt: Date.now(), input, tracks: null, behavior });
    globalMock.__kieMockLast = taskId;
    if (behavior.ambiguous) throw new AmbiguousSubmitError(`Mock: response lost for ${taskId}`);
    return taskId;
  },

  async status(taskId: string): Promise<KieTaskStatus> {
    const t = tasks.get(taskId);
    if (!t) return { state: "fail", tracks: [], invalidTracks: 0, failMsg: "Unknown mock task (server restarted?)", creditsConsumed: null };
    if (Date.now() - t.createdAt < env.mockKieDelayMs) return { state: "generating", tracks: [], invalidTracks: 0, failMsg: null, creditsConsumed: null };
    if (t.behavior.fail) return { state: "fail", tracks: [], invalidTracks: 0, failMsg: t.behavior.fail, creditsConsumed: 0 };
    if (t.behavior.empty) return { state: "success", tracks: [], invalidTracks: 1, failMsg: null, creditsConsumed: 12 };
    if (!t.tracks) {
      const dir = path.join(env.storageLocalDir || path.join(process.cwd(), "storage"), "mock");
      const n = t.behavior.tracks ?? 2;
      const tracks: KieTrack[] = [];
      for (let i = 1; i <= n; i++) {
        const kind = t.behavior.kinds?.[i - 1] ?? "tone";
        const file = path.join(dir, `${taskId}-${i}-${kind}.mp3`);
        await makeMockAudio(file, kind, 261.63 * Math.pow(2, (i * 3 + (taskId.charCodeAt(taskId.length - 1) % 5)) / 12));
        tracks.push({ id: `${taskId}-audio-${i}`, audio_url: `file://${file}`, title: t.input.title, duration: kind === "short" ? 20 : MOCK_DURATION, tags: t.input.style.slice(0, 60), model_name: "mock-suno" });
      }
      t.tracks = tracks;
    }
    return { state: "success", tracks: t.tracks, invalidTracks: 0, failMsg: null, creditsConsumed: 12 };
  },

  /** Spread the sung lyrics evenly across the mock track, keeping section tags attached like Suno does. */
  async aligned(taskId: string, _audioId: string): Promise<KieAlignedWord[]> {
    const t = tasks.get(taskId);
    const lyrics = t?.input.lyrics ?? "";
    const tokens: string[] = [];
    for (const block of lyrics.split(/\n\s*\n/)) {
      const lines = block.split("\n");
      const tag = lines[0]?.startsWith("[") ? lines.shift()! : "";
      const words = lines.join(" ").split(/\s+/).filter(Boolean);
      words.forEach((w, i) => tokens.push(i === 0 && tag ? `${tag}\n${w}` : w));
    }
    const usable = MOCK_DURATION - 10;
    const step = usable / Math.max(tokens.length, 1);
    return tokens.map((word, i) => ({ word, success: true, startS: Number((5 + i * step).toFixed(2)), endS: Number((5 + (i + 0.9) * step).toFixed(2)), palign: 0 }));
  },
};

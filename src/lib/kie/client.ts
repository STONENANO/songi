/**
 * Kie.ai client for the Suno music endpoints. All requests go through the
 * unified jobs API: POST /api/v1/jobs/createTask and GET /api/v1/jobs/recordInfo.
 * In mock mode, tasks complete after a few seconds with ffmpeg-generated audio.
 */
import path from "node:path";
import fs from "node:fs";
import { env } from "../env";
import type { KieAlignedWord, KieTaskStatus, KieTrack } from "./types";
import type { KieMusicInput } from "../songcraft/style";
import { makeTestTone } from "../audio/ffmpeg";

const BASE = "https://api.kie.ai";

async function kieFetch<T>(pathname: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.kieApiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json()) as { code: number; msg: string; data: T };
  if (!res.ok || body.code !== 200) {
    throw new Error(`Kie.ai ${pathname} failed: HTTP ${res.status}, code ${body.code}: ${body.msg}`);
  }
  return body.data;
}

export async function createMusicTask(input: KieMusicInput, callBackUrl: string): Promise<string> {
  if (env.mockKie) return mock.create(input);
  const data = await kieFetch<{ taskId: string }>("/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify({ model: "ai-music-api/generate", callBackUrl, input }),
  });
  return data.taskId;
}

/** Recursively find track-like objects in whatever shape resultJson takes. */
function extractTracks(node: unknown, out: KieTrack[] = []): KieTrack[] {
  if (Array.isArray(node)) {
    for (const n of node) extractTracks(n, out);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const audio = (o.audio_url ?? o.audioUrl ?? o.source_audio_url ?? o.sourceAudioUrl) as string | undefined;
    if (audio && typeof o.id === "string") {
      out.push({
        id: o.id,
        audio_url: audio,
        stream_audio_url: (o.stream_audio_url ?? o.streamAudioUrl) as string | undefined,
        image_url: (o.image_url ?? o.imageUrl) as string | undefined,
        title: o.title as string | undefined,
        duration: typeof o.duration === "number" ? o.duration : undefined,
        tags: o.tags as string | undefined,
        model_name: (o.model_name ?? o.modelName) as string | undefined,
      });
    } else {
      for (const v of Object.values(o)) extractTracks(v, out);
    }
  }
  return out;
}

export async function getTaskStatus(taskId: string): Promise<KieTaskStatus> {
  if (env.mockKie) return mock.status(taskId);
  const data = await kieFetch<{
    state: KieTaskStatus["state"];
    resultJson?: string | null;
    response?: unknown;
    failMsg?: string | null;
  }>(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { method: "GET" });

  let parsed: unknown = data.response ?? null;
  if (!parsed && data.resultJson) {
    try {
      parsed = JSON.parse(data.resultJson);
    } catch {
      parsed = null;
    }
  }
  return { state: data.state, tracks: parsed ? extractTracks(parsed) : [], failMsg: data.failMsg ?? null };
}

export async function getTimestampedLyrics(taskId: string, audioId: string): Promise<KieAlignedWord[]> {
  if (env.mockKie) return mock.aligned(taskId, audioId);
  const data = await kieFetch<{ code: number; msg: string; data?: { alignedWords?: KieAlignedWord[] } }>(
    "/api/v1/jobs/createTask",
    {
      method: "POST",
      body: JSON.stringify({ model: "ai-music-api/timeStamped-lyrics", input: { task_id: taskId, audio_id: audioId } }),
    },
  );
  if (data.code !== 200) throw new Error(`Timestamped lyrics failed: ${data.msg}`);
  return data.data?.alignedWords ?? [];
}

/* -------------------------------------------------------------------------- */
/* Mock implementation                                                         */
/* -------------------------------------------------------------------------- */

type MockTask = { createdAt: number; input: KieMusicInput; tracks: KieTrack[] | null };
const globalMock = globalThis as unknown as { __kieMock?: Map<string, MockTask> };
const tasks = (globalMock.__kieMock ??= new Map<string, MockTask>());
const MOCK_DELAY_MS = 6000;
const MOCK_DURATION = 120;

const mock = {
  async create(input: KieMusicInput): Promise<string> {
    const taskId = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    tasks.set(taskId, { createdAt: Date.now(), input, tracks: null });
    return taskId;
  },

  async status(taskId: string): Promise<KieTaskStatus> {
    const t = tasks.get(taskId);
    if (!t) return { state: "fail", tracks: [], failMsg: "Unknown mock task (server restarted?)" };
    if (Date.now() - t.createdAt < MOCK_DELAY_MS) return { state: "generating", tracks: [], failMsg: null };
    if (!t.tracks) {
      const dir = path.join(process.cwd(), "storage", "mock");
      fs.mkdirSync(dir, { recursive: true });
      const tracks: KieTrack[] = [];
      for (const [i, freq] of [[1, 329.63], [2, 392.0]] as const) {
        const file = path.join(dir, `${taskId}-${i}.mp3`);
        if (!fs.existsSync(file)) await makeTestTone(file, MOCK_DURATION, freq);
        tracks.push({
          id: `${taskId}-audio-${i}`,
          audio_url: `file://${file}`,
          title: t.input.title,
          duration: MOCK_DURATION,
          tags: t.input.style.slice(0, 60),
          model_name: "mock-suno",
        });
      }
      t.tracks = tracks;
    }
    return { state: "success", tracks: t.tracks, failMsg: null };
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
    return tokens.map((word, i) => ({
      word,
      success: true,
      startS: Number((5 + i * step).toFixed(2)),
      endS: Number((5 + (i + 0.9) * step).toFixed(2)),
      palign: 0,
    }));
  },
};

/**
 * Minimal ffmpeg wrapper. Everything is a child process; no native bindings.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin} exited ${code}: ${stderr.slice(-800)}`))));
  });
}

/**
 * Download http(s) or copy file:// into dest, with a size cap and a content-type
 * check. Callers must validate the URL first (kie/client.ts assertSafeAudioUrl).
 */
export async function downloadToFile(url: string, dest: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<number> {
  const maxBytes = opts.maxBytes ?? 60 * 1024 * 1024;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (url.startsWith("file://")) {
    const src = url.slice("file://".length);
    if (fs.statSync(src).size > maxBytes) throw new Error("Audio file exceeds the size limit.");
    fs.copyFileSync(src, dest);
    return fs.statSync(dest).size;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000), redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed with HTTP ${res.status}.`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type && !/^(audio\/|application\/octet-stream|binary\/octet-stream)/.test(type)) throw new Error(`Unexpected content type "${type}" for audio.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Audio file exceeds the size limit.");
  let seen = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      seen += chunk.byteLength;
      if (seen > maxBytes) ctrl.error(new Error("Audio file exceeds the size limit."));
      else ctrl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(limiter) as never), fs.createWriteStream(dest));
  return seen;
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`Could not read duration of ${file}`);
  return d;
}

/**
 * Loudness-normalise to a streaming-friendly level and re-encode as MP3.
 * The provider's tags are dropped (they carry the sung lyrics, with phonetic
 * respellings like "Shiv-awn" for Siobhan); the customer's title and lyrics go in instead.
 */
export async function normalizeToMp3(src: string, dest: string, meta: { title?: string; lyrics?: string } = {}): Promise<void> {
  const tags: string[] = ["-map_metadata", "-1"];
  if (meta.title) tags.push("-metadata", `title=${meta.title}`);
  if (meta.lyrics) tags.push("-metadata", `lyrics-eng=${meta.lyrics}`);
  await run("ffmpeg", ["-y", "-i", src, ...tags, "-id3v2_version", "3", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-codec:a", "libmp3lame", "-q:a", "2", dest]);
}

/** Cut a preview with short fades. */
export async function cutPreview(src: string, dest: string, start: number, seconds: number): Promise<void> {
  const fade = Math.min(1.5, seconds / 10);
  await run("ffmpeg", [
    "-y",
    "-ss",
    start.toFixed(2),
    "-t",
    seconds.toFixed(2),
    "-i",
    src,
    "-map_metadata",
    "-1",
    "-af",
    `afade=t=in:st=0:d=${fade},afade=t=out:st=${(seconds - fade).toFixed(2)}:d=${fade}`,
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "4",
    dest,
  ]);
}

/** Mock-mode only: a gentle tone with a slow tremolo so two versions sound different. */
export async function makeTestTone(dest: string, seconds: number, freq: number): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=${seconds}`,
    "-af",
    "tremolo=f=0.5:d=0.6,volume=0.3",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "6",
    dest,
  ]);
}

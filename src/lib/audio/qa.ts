/**
 * Lightweight technical QA with ffprobe/ffmpeg. Catches broken or unusable
 * audio before a customer hears it: corrupt or truncated downloads, empty or
 * very short files, long digital silence and gross clipping.
 *
 * This says nothing about whether the performance is good. Musical judgement
 * stays with lyric alignment heuristics and, ultimately, human listening.
 */
import fs from "node:fs";
import { run } from "./ffmpeg";

export type AudioQa = {
  pass: boolean;
  format: string;
  codec: string;
  duration: number;
  sizeBytes: number;
  bitRate: number | null;
  maxVolumeDb: number | null;
  meanVolumeDb: number | null;
  clippedRatio: number;
  silences: { start: number; end: number; duration: number }[];
  longestInternalSilence: number;
  decodeErrors: number;
  reasons: string[];
  warnings: string[];
};

const AUDIO_FORMATS = /mp3|wav|aac|m4a|mov|mp4|ogg|flac|matroska|webm/;

export async function technicalQa(file: string, opts: { requestedDuration?: number | null } = {}): Promise<AudioQa> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const sizeBytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const base: AudioQa = { pass: false, format: "", codec: "", duration: 0, sizeBytes, bitRate: null, maxVolumeDb: null, meanVolumeDb: null, clippedRatio: 0, silences: [], longestInternalSilence: 0, decodeErrors: 0, reasons, warnings };
  let sampleRate = 0;
  let channels = 0;
  if (sizeBytes < 20_000) {
    reasons.push(`File is ${sizeBytes} bytes: missing or incomplete download.`);
    return base;
  }

  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=format_name,duration,bit_rate:stream=codec_name,codec_type,sample_rate,channels", "-of", "json", file]);
    const j = JSON.parse(stdout) as { format?: { format_name?: string; duration?: string; bit_rate?: string }; streams?: { codec_name?: string; codec_type?: string; sample_rate?: string; channels?: number }[] };
    const audio = j.streams?.find((s) => s.codec_type === "audio");
    base.format = j.format?.format_name ?? "";
    base.duration = Number(j.format?.duration ?? 0) || 0;
    base.bitRate = j.format?.bit_rate ? Number(j.format.bit_rate) : null;
    base.codec = audio?.codec_name ?? "";
    sampleRate = Number(audio?.sample_rate ?? 0);
    channels = Number(audio?.channels ?? 0);
  } catch (e) {
    reasons.push(`Not a readable audio file: ${(e as Error).message.split("\n")[0]}`);
    return base;
  }
  if (!AUDIO_FORMATS.test(base.format) || !base.codec) reasons.push(`Unsupported or missing audio stream (format "${base.format}").`);
  if (!(base.duration > 0)) reasons.push("Audio has no duration.");
  if (reasons.length) return base;

  // One decode pass: errors, silence and volume statistics.
  let stderr = "";
  try {
    ({ stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-v", "info", "-i", file, "-af", "silencedetect=noise=-50dB:d=3,volumedetect", "-f", "null", "-"]));
  } catch (e) {
    stderr = (e as Error).message;
    base.decodeErrors++;
  }
  base.decodeErrors += (stderr.match(/(Error while decoding|Invalid data found|corrupt|Header missing|invalid frame)/gi) ?? []).length;
  for (const m of stderr.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)) {
    const end = Number(m[1]);
    const d = Number(m[2]);
    base.silences.push({ start: Math.max(0, end - d), end, duration: d });
  }
  const openStart = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  if (openStart.length > base.silences.length) {
    const s = openStart[openStart.length - 1];
    base.silences.push({ start: s, end: base.duration, duration: base.duration - s });
  }
  // ffmpeg can print a statistic more than once (e.g. an early "n_samples: 0"); the last value is the final one.
  const num = (re: RegExp) => {
    const all = [...stderr.matchAll(new RegExp(re.source, "g"))];
    return all.length ? Number(all[all.length - 1][1]) : null;
  };
  base.maxVolumeDb = num(/max_volume:\s*(-?[\d.]+) dB/);
  base.meanVolumeDb = num(/mean_volume:\s*(-?[\d.]+) dB/);
  const nSamples = num(/n_samples:\s*(\d+)/) ?? 0;
  const at0 = num(/histogram_0db:\s*(\d+)/) ?? 0;
  base.clippedRatio = nSamples ? at0 / nSamples : 0;

  // The header's duration can lie for a truncated download (MP3 headers declare the full length).
  // Measure what actually decodes and use that.
  if (nSamples && sampleRate && channels) {
    const decoded = nSamples / (sampleRate * channels);
    if (decoded < base.duration * 0.9) reasons.push(`Incomplete file: header says ${base.duration.toFixed(0)}s but only ${decoded.toFixed(0)}s decodes.`);
    base.duration = decoded;
  }

  // Rules
  if (base.decodeErrors > 3) reasons.push(`${base.decodeErrors} decode errors: corrupted or truncated file.`);
  else if (base.decodeErrors > 0) warnings.push(`${base.decodeErrors} minor decode error(s).`);
  if (base.duration < 30) reasons.push(`Only ${base.duration.toFixed(0)} seconds long.`);
  if (opts.requestedDuration && base.duration < opts.requestedDuration * 0.5) reasons.push(`${base.duration.toFixed(0)}s is under half the requested ${opts.requestedDuration}s: likely truncated.`);
  const internal = base.silences.filter((s) => s.start > 2 && s.end < base.duration - 1);
  base.longestInternalSilence = internal.reduce((m, s) => Math.max(m, s.duration), 0);
  const totalSilence = base.silences.reduce((t, s) => t + s.duration, 0);
  if (base.longestInternalSilence >= 10) reasons.push(`${base.longestInternalSilence.toFixed(0)}s of silence in the middle of the track.`);
  if (base.duration > 0 && totalSilence / base.duration > 0.3) reasons.push(`${Math.round((totalSilence / base.duration) * 100)}% of the track is silent.`);
  const trailing = base.silences.find((s) => s.end >= base.duration - 1);
  if (trailing && trailing.duration >= 15) warnings.push(`${trailing.duration.toFixed(0)}s of trailing silence.`);
  if (base.clippedRatio > 0.01) reasons.push(`Gross clipping: ${(base.clippedRatio * 100).toFixed(1)}% of samples at 0 dB.`);
  else if (base.clippedRatio > 0.001) warnings.push(`Some clipping: ${(base.clippedRatio * 100).toFixed(2)}% of samples at 0 dB.`);

  base.pass = reasons.length === 0;
  return base;
}

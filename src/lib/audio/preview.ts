/**
 * Pick where the preview starts. The goal is the first chorus that sings the
 * recipient's name: that is the moment that sells the song.
 */
import type { AlignedWord } from "../db/schema";

export type PreviewChoice = { start: number; reason: "chorus_with_name" | "first_chorus" | "first_name" | "start" };

function cleanWord(w: string): string {
  return w.replace(/\[[^\]]*\]\s*/g, "").toLowerCase().replace(/[^a-z0-9'\-]/g, "");
}

export function choosePreviewStart(opts: {
  aligned: AlignedWord[];
  names: string[];
  duration: number;
  previewSeconds: number;
  leadIn?: number;
}): PreviewChoice {
  const { aligned, duration, previewSeconds } = opts;
  const leadIn = opts.leadIn ?? 1.5;
  const names = opts.names.map((n) => n.toLowerCase()).filter(Boolean);
  const maxStart = Math.max(0, duration - previewSeconds);
  const clamp = (s: number) => Math.min(Math.max(0, s - leadIn), maxStart);

  let section = "";
  let firstChorusStart: number | null = null;
  let firstNameStart: number | null = null;
  for (const w of aligned) {
    const tag = w.word.match(/\[([^\]]+)\]/);
    if (tag) section = tag[1].toLowerCase();
    const inChorus = section.includes("chorus") || section.includes("hook");
    if (inChorus && firstChorusStart === null) firstChorusStart = w.startS;
    const cw = cleanWord(w.word);
    const isName = names.some((n) => cw === n || cw.startsWith(n));
    if (isName && firstNameStart === null) firstNameStart = w.startS;
    if (inChorus && isName) return { start: clamp(w.startS), reason: "chorus_with_name" };
  }
  if (firstChorusStart !== null) return { start: clamp(firstChorusStart), reason: "first_chorus" };
  if (firstNameStart !== null) return { start: clamp(firstNameStart), reason: "first_name" };
  return { start: 0, reason: "start" };
}

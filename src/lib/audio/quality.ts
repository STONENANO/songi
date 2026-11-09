/**
 * Audio quality gate. Suno fails in predictable ways: truncated clips, skipped
 * sections, mangled words. We compare the timestamped transcript against the
 * lyrics we sent and reject clips that fall short before anyone hears them.
 */
import type { AlignedWord } from "../db/schema";

export type QualityReport = {
  pass: boolean;
  coverage: number;
  matchedWords: number;
  totalWords: number;
  duration: number;
  targetDuration: number;
  reasons: string[];
};

function tokenize(text: string): string[] {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 1);
}

export function lyricCoverage(sungLyrics: string, aligned: AlignedWord[]): { coverage: number; matched: number; total: number } {
  const expected = tokenize(sungLyrics);
  const heard = new Map<string, number>();
  for (const w of aligned) {
    if (!w.success) continue;
    for (const t of tokenize(w.word)) heard.set(t, (heard.get(t) ?? 0) + 1);
  }
  let matched = 0;
  for (const t of expected) {
    const n = heard.get(t) ?? 0;
    if (n > 0) {
      matched++;
      heard.set(t, n - 1);
    }
  }
  return { coverage: expected.length ? matched / expected.length : 1, matched, total: expected.length };
}

export function evaluateVersion(opts: {
  sungLyrics: string;
  aligned: AlignedWord[] | null;
  duration: number;
  targetDuration: number;
  minCoverage: number;
}): QualityReport {
  const reasons: string[] = [];
  const cov = opts.aligned ? lyricCoverage(opts.sungLyrics, opts.aligned) : { coverage: 1, matched: 0, total: 0 };
  if (opts.aligned && cov.coverage < opts.minCoverage) {
    reasons.push(`Only ${(cov.coverage * 100).toFixed(0)}% of the lyrics were sung (minimum ${(opts.minCoverage * 100).toFixed(0)}%).`);
  }
  const ratio = opts.duration / opts.targetDuration;
  if (ratio < 0.5) reasons.push(`Clip is ${opts.duration.toFixed(0)}s, far shorter than the ${opts.targetDuration}s target: likely truncated.`);
  if (opts.duration < 45) reasons.push("Clip is under 45 seconds.");
  // A clip whose last sung word ends well before the audio does is fine (outro);
  // a clip whose audio ends while words remain unsung is truncated.
  if (opts.aligned && opts.aligned.length) {
    const lastWordEnd = Math.max(...opts.aligned.map((w) => w.endS));
    if (lastWordEnd > opts.duration + 1) reasons.push("Transcript extends past the end of the audio: truncated render.");
  }
  return {
    pass: reasons.length === 0,
    coverage: cov.coverage,
    matchedWords: cov.matched,
    totalWords: cov.total,
    duration: opts.duration,
    targetDuration: opts.targetDuration,
    reasons,
  };
}

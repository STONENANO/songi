/**
 * Turn stored display lyrics + the writer's fact placement into sections whose
 * lines know which story detail they carry. Pure functions, safe on client and server.
 */
export type ViewLine = { text: string; source?: string };
export type ViewSection = { tag: string; lines: ViewLine[] };
export type StoryLine = { line: string; fact: string; quote: string };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, "").replace(/\s+/g, " ").trim();

export function buildLyricSections(displayLyrics: string, storyLines: StoryLine[]): ViewSection[] {
  const byLine = new Map<string, StoryLine>();
  for (const s of storyLines) if (norm(s.line)) byLine.set(norm(s.line), s);
  const sections: ViewSection[] = [];
  let current: ViewSection | null = null;
  const used = new Set<string>();

  for (const raw of displayLyrics.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const tag = line.match(/^\[(.+)\]$/);
    if (tag) {
      current = { tag: tag[1], lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { tag: "", lines: [] };
      sections.push(current);
    }
    // Choruses repeat: highlight a detail on its first appearance only.
    const hit = byLine.get(norm(line));
    const source = hit && !used.has(hit.fact) ? (hit.quote || hit.fact) : undefined;
    if (hit) used.add(hit.fact);
    current.lines.push({ text: line, source });
  }
  return sections;
}

/** The first chorus, for the preview page. */
export function chorusOf(sections: ViewSection[]): ViewSection | undefined {
  return sections.find((s) => /chorus/i.test(s.tag));
}

/** Number of lyric lines that carry a story detail. */
export function storyLineCount(sections: ViewSection[]): number {
  return sections.reduce((n, s) => n + s.lines.filter((l) => l.source).length, 0);
}

export type TimedWord = { word: string; startS: number; endS: number };
export type TimedLine = ViewLine & { start: number | null };
export type TimedSection = { tag: string; lines: TimedLine[] };

const wordKey = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Give each lyric line the time it starts being sung, from the recording's word timings.
 * Walks the lines and the sung words in order; a line's start is the first of its words
 * found a little ahead in the sung stream, so ad-libs, repeats and respelled names don't
 * derail it. Lines that can't be placed get times interpolated between their neighbours.
 */
export function timeLyricLines(sections: ViewSection[], aligned: TimedWord[] | null | undefined): TimedSection[] {
  const stream = (aligned ?? [])
    .flatMap((w) => w.word.split(/\s+/).map((part) => ({ key: wordKey(part), t: w.startS })))
    .filter((w) => w.key);
  const out: TimedSection[] = sections.map((s) => ({ tag: s.tag, lines: s.lines.map((l) => ({ ...l, start: null as number | null })) }));
  if (!stream.length) return out;

  const flat = out.flatMap((s) => s.lines);
  let pos = 0;
  const LOOKAHEAD = 12;
  for (const line of flat) {
    const words = line.text.split(/\s+/).map(wordKey).filter(Boolean);
    let first: number | null = null;
    for (const w of words) {
      let hit = -1;
      for (let j = pos; j < Math.min(stream.length, pos + LOOKAHEAD); j++) {
        if (stream[j].key === w) {
          hit = j;
          break;
        }
      }
      if (hit >= 0) {
        if (first === null) first = stream[hit].t;
        pos = hit + 1;
      }
    }
    line.start = first;
  }

  // Keep times increasing, then fill gaps by interpolation.
  let last = -Infinity;
  for (const l of flat) {
    if (l.start !== null && l.start < last) l.start = null;
    if (l.start !== null) last = l.start;
  }
  const known = flat.map((l, i) => (l.start !== null ? i : -1)).filter((i) => i >= 0);
  if (known.length < Math.max(2, flat.length * 0.4)) return out.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, start: null })) }));
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].start !== null) continue;
    const prev = [...known].reverse().find((k) => k < i);
    const next = known.find((k) => k > i);
    if (prev !== undefined && next !== undefined) {
      const a = flat[prev].start!, b = flat[next].start!;
      flat[i].start = a + ((b - a) * (i - prev)) / (next - prev);
    } else if (prev !== undefined) flat[i].start = flat[prev].start! + 2 * (i - prev);
    else if (next !== undefined) flat[i].start = Math.max(0, flat[next].start! - 2 * (next - i));
  }
  return out;
}

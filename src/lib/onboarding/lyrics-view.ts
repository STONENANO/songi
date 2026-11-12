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

/**
 * Turn stored display lyrics + the verifier report into sections whose lines
 * know which story detail they carry. Pure functions, safe on client and server.
 */
export type ViewLine = { text: string; source?: string };
export type ViewSection = { tag: string; lines: ViewLine[] };

type Coverage = { fact: string; covered: boolean; evidence: string };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, "").replace(/\s+/g, " ").trim();

export function buildLyricSections(displayLyrics: string, report: unknown): ViewSection[] {
  const coverage = ((report as { factCoverage?: Coverage[] } | null)?.factCoverage ?? []).filter((c) => c.covered && norm(c.evidence).length >= 4);
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
    const n = norm(line);
    // A fact highlights the first line that carries it (choruses repeat; only mark once).
    const hit = coverage.find((c) => !used.has(c.fact) && (n.includes(norm(c.evidence)) || norm(c.evidence).includes(n)));
    if (hit) used.add(hit.fact);
    current.lines.push({ text: line, source: hit?.fact });
  }
  return sections;
}

/** The first chorus, for the preview page. */
export function chorusOf(sections: ViewSection[]): ViewSection | undefined {
  return sections.find((s) => /chorus/i.test(s.tag));
}

/** Count of distinct story details that made it into the lyrics. */
export function storyLineCount(sections: ViewSection[]): number {
  return sections.reduce((n, s) => n + s.lines.filter((l) => l.source).length, 0);
}

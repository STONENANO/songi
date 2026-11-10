/**
 * Golden suite: run brief -> lyrics -> verifier over every fixture in
 * scripts/golden and print a scorecard. No audio, no Suno cost.
 *
 *   npm run golden                                   # current settings, all fixtures
 *   npm run golden -- --only mom                     # fixtures whose name starts with "mom"
 *   npm run golden -- --a writer=v1 --b writer=v2    # A/B: one variable at a time
 *   npm run golden -- --a writer=v2 --b writer=v3    # idea-first writer vs current
 *   npm run golden -- --a arrangement=legacy_blueprint --b arrangement=adaptive
 *   npm run golden -- --a direction=legacy --b direction=director   (style prompts only)
 *   npm run golden -- --json data/golden-out/run.json
 *
 * The brief is extracted once per fixture and shared by both arms, so only the
 * variable under test differs. Factual correctness is a hard gate; creative
 * scores are the verifier's subjective judgement and experimental.
 * In mock mode (no ANTHROPIC_API_KEY) scores are placeholders.
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { extractBrief, writeLyrics, getGenre, buildKieInput, genreArchetypes, countIssues, type QuizInput } from "../src/lib/songcraft";
import { withUsage } from "../src/lib/llm/client";
import { env } from "../src/lib/env";

type Arm = { writer?: "v1" | "v2" | "v3"; arrangement?: string; direction?: "director" | "legacy"; vocal?: "specific" | "generic" };

function parseArm(s: string | undefined): Arm {
  const arm: Arm = {};
  for (const kv of (s ?? "").split(",").filter(Boolean)) {
    const [k, v] = kv.split("=");
    (arm as Record<string, string>)[k] = v;
  }
  return arm;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Row = {
  fixture: string;
  arm: string;
  status: string;
  facts: number;
  verifiedQuotes: number;
  omitted: number;
  critical: number;
  factualCritical: number;
  warnings: number;
  creative: number | null;
  attempts: number;
  llmCalls: number;
  estCostUsd: number;
  styleChars: number[];
  durations: number[];
};

async function main() {
  const dir = path.join(process.cwd(), "scripts/golden");
  const only = arg("only");
  const arms: [string, Arm][] = arg("a") || arg("b") ? [["A", parseArm(arg("a"))], ["B", parseArm(arg("b"))]] : [["current", {}]];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && (!only || f.startsWith(only))).sort();
  const outDir = path.join(process.cwd(), "data/golden-out");
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`mode: ${env.mockLlm ? "MOCK (placeholder lyrics and scores)" : env.llmModel} | ${files.length} fixtures | arms: ${arms.map(([n, a]) => `${n}=${JSON.stringify(a)}`).join("  ")}\n`);

  const rows: Row[] = [];
  for (const file of files) {
    const input = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as QuizInput;
    const { result: brief, usage: briefUsage } = await withUsage(() => extractBrief(input));
    let md = `# ${file}\n\n## Brief\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\`\n`;
    if (brief.followUpQuestions.length) md += `\nFollow-up questions would be asked: ${brief.followUpQuestions.join(" | ")}\n`;

    for (const [armName, arm] of arms) {
      const genre = getGenre(input.genreKey);
      const { result, usage } = await withUsage(() =>
        writeLyrics({ brief, genre, mood: input.mood, occasion: input.occasion, writerVersion: arm.writer, arrangementOverride: arm.arrangement === "adaptive" ? undefined : arm.arrangement }),
      );
      const c = result.chosen;
      const counts = countIssues(c.issues);
      const styles: { archetype: string; label: string; style: string; duration?: number; conflicts: string[] }[] = [];
      for (const [i, archetype] of genreArchetypes(genre).entries()) {
        try {
          const b = buildKieInput({ genreKey: input.genreKey, vocalGender: input.vocalGender, mood: input.mood, customStyle: input.customStyle, title: c.title, sungLyrics: c.sungLyrics, kieModel: "V6", arrangementId: c.arrangementId, archetype, relationship: brief.recipient.relationship, occasion: input.occasion, variantIndex: i, directionMode: arm.direction, vocalMode: arm.vocal });
          styles.push({ archetype, label: b.direction?.variantLabel ?? "legacy", style: b.input.style, duration: b.input.duration, conflicts: b.direction?.conflicts ?? [] });
        } catch (e) {
          styles.push({ archetype, label: "error", style: (e as Error).message, conflicts: [] });
        }
        if (arm.direction === "legacy") break;
      }
      const all = [...briefUsage, ...usage];
      rows.push({
        fixture: file.replace(".json", ""),
        arm: armName,
        status: c.status,
        facts: brief.facts.length,
        verifiedQuotes: brief.facts.filter((f) => f.provenance === "verified").length,
        omitted: brief.omittedFacts.length,
        critical: counts.critical,
        factualCritical: counts.factual,
        warnings: counts.warnings,
        creative: c.creativeScore,
        attempts: result.attempts.length,
        llmCalls: all.length,
        estCostUsd: all.reduce((s, u) => s + u.estCostUsd, 0),
        styleChars: styles.map((s) => s.style.length),
        durations: styles.map((s) => s.duration ?? 0),
      });
      md += `\n## Arm ${armName} ${JSON.stringify(arm)}: ${c.status}, arrangement ${c.arrangementId} (${result.arrangement.reason})\n\n### ${c.title}\n\n\`\`\`\n${c.displayLyrics}\n\`\`\`\n`;
      if (c.sungLyrics !== c.displayLyrics) md += `\nSung version differs (respelling or numbers):\n\`\`\`\n${c.sungLyrics}\n\`\`\`\n`;
      md += `\nPlan: ${JSON.stringify(c.lyrics.plan)}\n\nIssues:\n${c.issues.map((i) => `- [${i.severity}/${i.category}/${i.source}] ${i.section ?? ""} ${i.reason}`).join("\n") || "- none"}\n\nAttempts: ${result.attempts.map((a) => `${a.source} (${a.status}, score ${a.creativeScore?.toFixed(2) ?? "-"})`).join(" → ")}\n\nNotes: ${c.notes.join(" ") || "none"}\n\nCreative scores: ${JSON.stringify(c.verifier?.scores ?? null)}\n`;
      md += `\n### Suno style prompts\n${styles.map((s) => `- **${s.label}** (${s.archetype}, ${s.duration ?? "-"}s, ${s.style.length} chars): ${s.style}${s.conflicts.length ? `\n  - conflicts: ${s.conflicts.join(" ")}` : ""}`).join("\n")}\n`;
    }
    fs.writeFileSync(path.join(outDir, file.replace(".json", ".md")), md);
    for (const r of rows.filter((x) => x.fixture === file.replace(".json", ""))) {
      console.log(
        `${r.fixture.padEnd(32)} ${r.arm.padEnd(7)} ${r.status.padEnd(8)} facts=${String(r.facts).padStart(2)} quotes=${r.verifiedQuotes}/${r.facts} crit=${r.critical} warn=${String(r.warnings).padStart(2)} creative=${r.creative ?? "-"} tries=${r.attempts} calls=${r.llmCalls} $${r.estCostUsd.toFixed(3)} style=${r.styleChars.join("/")}c dur=${r.durations.join("/")}s`,
      );
    }
  }

  console.log("\nSummary (factual pass is a hard gate; creative score is experimental)");
  for (const [armName] of arms) {
    const rs = rows.filter((r) => r.arm === armName);
    const verified = rs.filter((r) => r.status === "verified").length;
    const creative = rs.filter((r) => r.creative !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    console.log(
      `  ${armName.padEnd(8)} verified ${verified}/${rs.length} | factual criticals ${rs.reduce((s, r) => s + r.factualCritical, 0)} | avg creative ${avg(creative.map((r) => r.creative!)).toFixed(2)} | avg LLM calls ${avg(rs.map((r) => r.llmCalls)).toFixed(2)} | avg est LLM cost $${avg(rs.map((r) => r.estCostUsd)).toFixed(4)}`,
    );
  }
  const json = arg("json");
  if (json) fs.writeFileSync(json, JSON.stringify({ mode: env.mockLlm ? "mock" : env.llmModel, arms, rows }, null, 2));
  console.log(`\nFull briefs, lyrics, issues and style prompts: data/golden-out/*.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

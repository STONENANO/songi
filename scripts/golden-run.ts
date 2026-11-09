/**
 * Run the songcraft text pipeline (brief -> lyrics -> verifier) over the golden
 * set and print a scorecard. No audio, no Suno cost. Run it every time a prompt,
 * blueprint, or registry entry changes.
 *   npm run golden            # all briefs
 *   npm run golden -- mom-60  # one brief by file stem
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { extractBrief, writeLyrics, getGenre, type QuizInput } from "../src/lib/songcraft";
import { env } from "../src/lib/env";

async function main() {
  const dir = path.join(process.cwd(), "scripts/golden");
  const only = process.argv[2];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && (!only || f.startsWith(only)));
  console.log(`mode: ${env.mockLlm ? "mock" : env.llmModel} | ${files.length} briefs\n`);
  const rows: string[] = [];
  for (const file of files) {
    const input = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as QuizInput;
    const t0 = Date.now();
    const brief = await extractBrief(input);
    const result = await writeLyrics({ brief, genre: getGenre(input.genreKey), mood: input.mood });
    const p1 = brief.facts.filter((f) => f.priority === 1).length;
    const covered = result.report.factCoverage.filter((c) => c.covered).length;
    const errors = result.report.issues.filter((i) => i.severity === "error").length + result.report.inventedDetails.length;
    rows.push(
      `${file.padEnd(22)} ${input.genreKey.padEnd(12)} facts=${String(brief.facts.length).padStart(2)} p1=${p1} covered=${covered}/${result.report.factCoverage.length} name_in_chorus=${result.report.nameInChorus ? "y" : "n"} errors=${errors} pass=${result.report.pass ? "Y" : "N"} tries=${result.attempts} ${Math.round((Date.now() - t0) / 1000)}s`,
    );
    const out = path.join(process.cwd(), "data/golden-out");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, file.replace(".json", ".md")), `# ${result.title}\n\n${result.displayLyrics}\n\n---\nBrief:\n${JSON.stringify(brief, null, 2)}\n\nVerifier:\n${JSON.stringify(result.report, null, 2)}\n`);
  }
  console.log(rows.join("\n"));
  console.log(`\nFull lyrics and reports written to data/golden-out/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

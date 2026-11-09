/**
 * End-to-end pipeline smoke test with no HTTP server involved.
 * Works in mock mode with zero keys; with real keys it spends ~1 Suno request.
 *   npm run smoke
 */
import "./load-env";
import { getDb, schema } from "../src/lib/db";
import { env } from "../src/lib/env";
import { runBriefing, submitFollowUpAnswers, startGeneration, pollIfGenerating, getRequestView } from "../src/lib/pipeline/run";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`mode: llm=${env.mockLlm ? "mock" : env.llmModel}, kie=${env.mockKie ? "mock" : env.kieModel}`);
  const db = await getDb();
  const [row] = await db
    .insert(schema.songRequests)
    .values({
      recipientName: "Siobhan",
      pronunciation: "Shiv-awn",
      relationship: "mom",
      occasion: "birthday",
      story:
        "Mom taught me to make pancakes every Sunday morning. She sings off-key in the car on every road trip and does not care who hears. Her happy place is the lake house in Michigan. She is turning sixty and still beats everyone at cards.",
      genreKey: "country",
      vocalGender: "f",
      mood: "heartfelt",
    })
    .returning({ id: schema.songRequests.id });
  const id = row.id;
  console.log("request", id);

  await runBriefing(id);
  let v = await getRequestView(id);
  console.log("after briefing:", v?.status, "| facts:", v?.brief?.facts.length, "| follow-ups:", v?.followUpQuestions);

  if (v?.status === "needs_input") {
    await submitFollowUpAnswers(id, Object.fromEntries(v.followUpQuestions.map((q) => [q, "She always says 'we will figure it out' and then does."])));
    v = await getRequestView(id);
    console.log("after answers:", v?.status);
  }
  if (v?.status !== "lyrics_ready") throw new Error(`expected lyrics_ready, got ${v?.status}: ${v?.lastError}`);
  console.log(`\n--- ${v.drafts[0].title} ---\n${v.drafts[0].displayLyrics}\n--- verifier: ${JSON.stringify(v.drafts[0].report)}\n`);

  const gen = await startGeneration(id);
  if (!gen.ok) throw new Error(gen.error);
  const started = Date.now();
  while (Date.now() - started < 8 * 60_000) {
    await pollIfGenerating(id);
    v = await getRequestView(id);
    process.stdout.write(`\r${v?.status.padEnd(14)} ${Math.round((Date.now() - started) / 1000)}s   `);
    if (v?.status === "preview_ready" || v?.status === "failed") break;
    await sleep(2000);
  }
  console.log("\n\nfinal:", v?.status, v?.lastError ?? "");
  for (const ver of v?.versions ?? []) {
    console.log(`  ${ver.status.padEnd(9)} ${ver.title} | ${ver.duration?.toFixed(1)}s | preview @ ${ver.previewStart?.toFixed(1)}s | ${ver.previewUrl}`);
    console.log(`           quality: ${JSON.stringify(ver.quality)}`);
  }
  if (v?.status !== "preview_ready") process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

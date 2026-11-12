/**
 * End-to-end pipeline smoke test without the HTTP server: quiz -> brief ->
 * follow-up -> lyrics -> multiple candidates -> select -> mock purchase -> unlock.
 * Mock mode costs nothing. With real keys it spends ~2 Suno tasks.
 *   npm run smoke
 */
import "./load-env";
import { getDb, schema } from "../src/lib/db";
import { env } from "../src/lib/env";
import { runBriefing, submitFollowUpAnswers, startGeneration, pollIfGenerating, getRequestView, selectVersion } from "../src/lib/pipeline/run";
import { startCheckout, payWithTestCheckout } from "../src/lib/commerce/orders";
import { newProjectToken } from "../src/lib/session/project";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`mode: llm=${env.mockLlm ? "mock" : env.llmModel}, kie=${env.mockKie ? "mock" : env.kieModel}, payments=${env.mockPayments ? "test" : "stripe"}`);
  const db = await getDb();
  const [row] = await db
    .insert(schema.songRequests)
    .values({
      recipientName: "Siobhan",
      pronunciation: "Shiv-awn",
      relationship: "mom",
      occasion: "birthday",
      story:
        "Mom taught me to make pancakes every Sunday morning. She sings off-key in the car on every road trip and does not care who hears. Her happy place is the lake house in Michigan. She is turning 60 and still beats everyone at cards.",
      genreKey: "country",
      vocalGender: "f",
      mood: "heartfelt",
      accessTokenHash: newProjectToken().hash,
    })
    .returning({ id: schema.songRequests.id });
  const id = row.id;
  console.log("request", id);

  await runBriefing(id);
  let v = await getRequestView(id);
  if (v?.status === "needs_input") {
    if ((await submitFollowUpAnswers(id, Object.fromEntries(v.followUpQuestions.map((q) => [q, "She always says 'we will figure it out' and then does."])))) === "started") await runBriefing(id);
    v = await getRequestView(id);
  }
  console.log("brief:", v?.brief?.facts.map((f) => `${f.id} [P${f.priority}/${f.provenance}] ${f.text}`).join(" | "));
  if (v?.status !== "lyrics_ready" || !v.draft) throw new Error(`expected lyrics_ready, got ${v?.status}: ${v?.lastError}`);
  console.log(`\n--- ${v.draft.title} (${v.draft.status}, arrangement ${v.draft.arrangementId}) ---\n${v.draft.displayLyrics}\n`);

  const gen = await startGeneration(id);
  if (!gen.ok) throw new Error(gen.error);
  console.log(`submitted ${gen.submitted} task(s)`);
  const started = Date.now();
  while (Date.now() - started < 10 * 60_000) {
    await pollIfGenerating(id, { force: true });
    v = await getRequestView(id);
    process.stdout.write(`\r${v?.status.padEnd(14)} usable ${v?.generation.usable}/${v?.generation.desired} tasks ${v?.generation.tasksTotal} ${Math.round((Date.now() - started) / 1000)}s   `);
    if (v?.status === "preview_ready" || v?.status === "failed") break;
    await sleep(env.mockKie ? 300 : 5000);
  }
  console.log(`\n\nstatus: ${v?.status} ${v?.lastError ?? ""}`);
  for (const c of v?.candidates ?? []) console.log(`  ${c.label.padEnd(20)} ${c.runtimeSec}s  preview ${c.previewUrl ? "signed" : "-"}  full ${c.downloadUrl ? "UNLOCKED" : "locked"}  ${c.description}`);
  if (v?.status !== "preview_ready" || !v.candidates.length) process.exit(1);

  const pick = v.candidates[0];
  await selectVersion(id, pick.id);
  const co = await startCheckout(id, pick.id);
  if (!co.ok) throw new Error(co.error);
  console.log(`checkout: ${co.checkoutUrl}`);
  if (env.mockPayments) {
    console.log("test payment:", await payWithTestCheckout(co.orderId), "| again:", await payWithTestCheckout(co.orderId));
  } else {
    console.log("Stripe is configured: pay at", `${env.appUrl}${co.checkoutUrl}`, "to finish (the smoke script does not charge cards).");
  }
  v = await getRequestView(id);
  console.log(`after purchase: ${v?.status}; unlocked: ${v?.candidates.filter((c) => c.downloadUrl).map((c) => c.label).join(", ") || "none"}; delivery ${v?.order?.deliveryLink ?? "-"}`);
  process.exit(v?.status === "purchased" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Business metrics from the events, cost ledger, generations, versions and
 * orders tables. Costs marked "est" come from configurable estimates
 * (LLM_*_COST_PER_MTOK, KIE_TASK_COST_USD), not from provider invoices.
 *   npm run metrics
 */
import "./load-env";
import { getDb, schema } from "../src/lib/db";

async function main() {
  const db = await getDb();
  const reqs = await db.select().from(schema.songRequests);
  const gens = await db.select().from(schema.generations);
  const vers = await db.select().from(schema.songVersions);
  const ords = await db.select().from(schema.orders);
  const ledger = await db.select().from(schema.costLedger);
  const evs = await db.select().from(schema.events);

  const n = reqs.length || 1;
  const llm = ledger.filter((l) => l.provider.startsWith("anthropic"));
  const kie = ledger.filter((l) => l.provider.startsWith("kie") && l.operation.startsWith("generate"));
  const previewSessions = reqs.filter((r) => ["preview_ready", "purchased"].includes(r.status) || r.candidatesFinalizedAt).length;
  const paid = ords.filter((o) => o.status === "paid");
  const sum = (xs: (string | number | null)[]) => xs.reduce<number>((s, x) => s + Number(x ?? 0), 0);
  const genCost = sum(kie.map((k) => k.costUsd));
  const llmCost = sum(llm.map((l) => l.costUsd));
  const revenue = sum(paid.map((o) => o.amountCents)) / 100;
  const plays = evs.filter((e) => e.type === "preview_play");
  const completes = evs.filter((e) => e.type === "preview_complete");
  const selections = evs.filter((e) => e.type === "candidate:selected");

  const line = (k: string, v: string) => console.log(`${k.padEnd(42)} ${v}`);
  console.log(`Projects: ${reqs.length}\n`);
  line("Avg LLM calls per project", (llm.length / n).toFixed(2));
  line("LLM cost per project (est)", `$${(llmCost / n).toFixed(4)}`);
  line("Kie tasks per project", (gens.length / n).toFixed(2));
  line("Tracks per completed task", (sum(gens.filter((g) => g.status === "complete").map((g) => g.trackCount)) / (gens.filter((g) => g.status === "complete").length || 1)).toFixed(2));
  line("Usable candidates per preview session", (vers.filter((v) => v.status === "ready").length / (previewSessions || 1)).toFixed(2));
  line("Generation cost per preview session (est)", `$${(genCost / (previewSessions || 1)).toFixed(3)}`);
  line("Preview play rate (plays / offered versions)", `${plays.length} / ${vers.filter((v) => v.offered).length}`);
  line("Preview completion rate", plays.length ? `${((completes.length / plays.length) * 100).toFixed(0)}%` : "-");
  line("Candidate selection rate (projects)", `${((new Set(selections.map((s) => s.requestId)).size / (previewSessions || 1)) * 100).toFixed(0)}%`);
  line("Preview-to-purchase conversion", `${((paid.length / (previewSessions || 1)) * 100).toFixed(1)}%`);
  line("Revenue per purchased song", paid.length ? `$${(revenue / paid.length).toFixed(2)}` : "-");
  line("Cost per purchased song (est, all projects)", paid.length ? `$${((genCost + llmCost) / paid.length).toFixed(2)}` : "-");
  line("Refunds", String(ords.filter((o) => o.status === "refunded").length));
  line("Regeneration rate (rounds > 1)", `${((reqs.filter((r) => r.generationAttempts > 1).length / n) * 100).toFixed(0)}%`);
  line("Duplicate payments flagged", String(ords.filter((o) => o.status === "duplicate_payment").length));

  // Preferred variants by genre and occasion (raw counts; control for position before drawing conclusions).
  const byKey = new Map<string, { offered: number; selected: number; purchased: number }>();
  for (const v of vers.filter((x) => x.offered || x.purchaseStatus === "paid")) {
    const r = reqs.find((q) => q.id === v.requestId);
    const k = `${r?.genreKey}/${r?.occasion} :: ${v.variantId ?? "legacy"}`;
    const e = byKey.get(k) ?? { offered: 0, selected: 0, purchased: 0 };
    e.offered++;
    if (v.selected) e.selected++;
    if (v.purchaseStatus === "paid") e.purchased++;
    byKey.set(k, e);
  }
  console.log(`\nVariant performance (genre/occasion :: variant): offered / selected / purchased`);
  for (const [k, e] of [...byKey.entries()].sort()) console.log(`  ${k.padEnd(48)} ${e.offered} / ${e.selected} / ${e.purchased}`);
  const ranks = selections.map((s) => (s.payload as { rank?: number } | null)?.rank).filter((x) => x !== undefined && x !== null);
  if (ranks.length) console.log(`\nSelections by on-screen position: ${[0, 1, 2].map((p) => `#${p + 1}: ${ranks.filter((r) => r === p).length}`).join("  ")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

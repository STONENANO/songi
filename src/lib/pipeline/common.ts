/** Shared pipeline helpers: events, status changes, cost and usage logging. */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { RequestStatus, SongRequest } from "../db/schema";
import type { LlmUsage } from "../llm/client";

const { songRequests, events, costLedger } = schema;

export async function logEvent(requestId: string | null, type: string, payload: Record<string, unknown> = {}) {
  const db = await getDb();
  await db.insert(events).values({ requestId, type, payload });
}

export async function setStatus(requestId: string, status: RequestStatus, extra: Partial<typeof songRequests.$inferInsert> = {}) {
  const db = await getDb();
  await db.update(songRequests).set({ status, updatedAt: new Date(), ...extra }).where(eq(songRequests.id, requestId));
  await logEvent(requestId, `status:${status}`, extra.lastError ? { error: extra.lastError } : {});
}

/**
 * Move to a new status only if the song is still in one of the expected ones, in a
 * single update. Lets an API route record "started" before it replies and before the
 * slow work runs in the background, and makes two simultaneous clicks start it once.
 * Returns false when the status had already changed.
 */
export async function claimStatus(requestId: string, from: RequestStatus[], to: RequestStatus, extra: Partial<typeof songRequests.$inferInsert> = {}): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(songRequests)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(and(eq(songRequests.id, requestId), inArray(songRequests.status, from)))
    .returning({ id: songRequests.id });
  if (rows.length) await logEvent(requestId, `status:${to}`, {});
  return rows.length > 0;
}

export async function failRequest(requestId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pipeline] request ${requestId} failed:`, message);
  await setStatus(requestId, "failed", { lastError: message });
}

export async function getRequest(id: string): Promise<SongRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [row] = await db.select().from(songRequests).where(eq(songRequests.id, id)).limit(1);
  return row ?? null;
}

/** Record LLM calls (actual tokens, estimated dollars) against a request. */
export async function recordLlmUsage(requestId: string, usage: LlmUsage[]) {
  if (!usage.length) return;
  const db = await getDb();
  await db.insert(costLedger).values(
    usage.map((u) => ({
      requestId,
      provider: u.mock ? "anthropic-mock" : "anthropic",
      operation: u.operation,
      units: u.inputTokens + u.outputTokens,
      costUsd: u.estCostUsd.toFixed(4),
    })),
  );
}

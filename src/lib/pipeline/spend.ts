/**
 * Lasting limits on Claude spend per song, counted in the database so restarts and
 * deploys don't reset them. A song's first lyrics are never blocked; these limits
 * apply to what the buyer can repeat: new lyrics and hand edits (each runs the
 * writer or the verifier). Kie spend has its own cap in generation.ts.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { env } from "../env";
import { logEvent } from "./common";

const { events, costLedger } = schema;
export const REWRITE_EVENT = "lyrics:rewrite_requested";

export type Allowance = { ok: true } | { ok: false; error: string };

export async function lyricRewriteAllowance(requestId: string): Promise<Allowance> {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.requestId, requestId), eq(events.type, REWRITE_EVENT)));
  if (n >= env.maxLyricRewrites) return { ok: false, error: "You've used all the lyric changes for this song." };
  const [{ usd }] = await db
    .select({ usd: sql<number>`coalesce(sum(${costLedger.costUsd}), 0)::float` })
    .from(costLedger)
    .where(and(eq(costLedger.requestId, requestId), eq(costLedger.provider, "anthropic")));
  if (usd >= env.maxLlmUsdPerSong) return { ok: false, error: "You've used all the lyric changes for this song." };
  return { ok: true };
}

/** Count one rewrite against the song. Call once the request has passed every other check. */
export async function recordRewrite(requestId: string, action: "regenerate" | "edit"): Promise<void> {
  await logEvent(requestId, REWRITE_EVENT, { action });
}

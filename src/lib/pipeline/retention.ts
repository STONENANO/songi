/**
 * Unpurchased audio is kept for PREVIEW_RETENTION_DAYS (14) after a song's versions are
 * ready, then deleted: previews and full takes of every version nobody bought. Paid,
 * pending and refunded versions are never touched. The direct preview link already
 * stopped working at PREVIEW_LINK_HOURS (48); this frees the storage behind it.
 *
 * Runs every few hours on the server (see instrumentation-node.ts). Safe on several
 * instances at once: each song is claimed with a conditional update before deleting.
 */
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "../db";
import { env } from "../env";
import { getStorage } from "../storage";
import { reportError } from "../observability";
import { logEvent } from "./common";

const { songRequests, songVersions } = schema;

export async function purgeExpiredPreviews(nowMs = Date.now(), batch = 50): Promise<{ songs: number; files: number }> {
  const db = await getDb();
  const cutoff = new Date(nowMs - env.previewRetentionDays * 24 * 3600_000);
  const due = await db
    .select({ id: songRequests.id })
    .from(songRequests)
    .where(and(isNotNull(songRequests.candidatesFinalizedAt), lt(songRequests.candidatesFinalizedAt, cutoff), isNull(songRequests.previewsPurgedAt)))
    .limit(batch);
  const storage = await getStorage();
  let songs = 0;
  let files = 0;
  for (const { id } of due) {
    // Claim the song so two servers never purge it twice.
    const claimed = await db.update(songRequests).set({ previewsPurgedAt: new Date(nowMs) }).where(and(eq(songRequests.id, id), isNull(songRequests.previewsPurgedAt))).returning({ id: songRequests.id });
    if (!claimed.length) continue;
    // Only versions nobody bought or is buying: "none". Paid, pending and refunded keep their files.
    const versions = await db.select().from(songVersions).where(and(eq(songVersions.requestId, id), eq(songVersions.purchaseStatus, "none")));
    let deleted = 0;
    for (const v of versions) {
      for (const key of [v.previewKey, v.audioKey]) {
        if (!key) continue;
        try {
          await storage.delete(key);
          deleted++;
        } catch (e) {
          reportError(e, { where: "purge_previews", requestId: id, versionId: v.id });
        }
      }
    }
    if (versions.length) {
      await db
        .update(songVersions)
        .set({ previewKey: null, audioKey: null, sourceAudioUrl: null, availability: "unavailable", offered: false, selected: false })
        .where(inArray(songVersions.id, versions.map((v) => v.id)));
    }
    await logEvent(id, "previews:purged", { versions: versions.length, files: deleted });
    songs++;
    files += deleted;
  }
  return { songs, files };
}

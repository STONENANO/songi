/**
 * Rate limiting and client identity.
 *
 * Counters live in the database (table rate_limits), so every server instance shares
 * them and a restart or deploy doesn't reset them. One atomic upsert per check:
 * the first hit in a window starts it, later hits add one, and a hit after the
 * window has passed starts a new one.
 */
import crypto from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { env } from "../env";
import { reportError } from "../observability";

const { rateLimits } = schema;

/** Keys are stored hashed, so the table never holds an IP address or a song id. */
const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

/** True if this hit is allowed: at most `limit` hits per `windowMs` for this key. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const secs = Math.max(1, Math.round(windowMs / 1000));
  try {
    const db = await getDb();
    const expired = sql`${rateLimits.windowStart} <= now() - make_interval(secs => ${secs})`;
    const [row] = await db
      .insert(rateLimits)
      .values({ key: hashKey(key), windowStart: sql`now()`, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        // Both expressions read the row as it was before this update.
        set: {
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
          windowStart: sql`CASE WHEN ${expired} THEN now() ELSE ${rateLimits.windowStart} END`,
        },
      })
      .returning({ count: rateLimits.count });
    // Now and then, drop counters nobody has used for a day.
    if (Math.random() < 0.01) void db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`)).catch(() => {});
    return row.count <= limit;
  } catch (e) {
    // A limiter that can't reach the database must not take the site down with it.
    reportError(e, { where: "rateLimit" });
    return true;
  }
}

/**
 * The visitor's IP address, for per-visitor limits.
 *
 * Never the first X-Forwarded-For entry: proxies append to that header, so its first
 * value is whatever the visitor sent. On Railway the edge sets X-Real-IP to the
 * connecting address (CLIENT_IP_HEADER overrides the header name); elsewhere the
 * last X-Forwarded-For entry is the one our own proxy added.
 */
export function clientIp(req: Request): string {
  const header = env.clientIpHeader;
  if (header) {
    const v = req.headers.get(header)?.trim();
    if (v) return v;
  }
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "local";
}

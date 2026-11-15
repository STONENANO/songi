/**
 * Database access. Uses Postgres when DATABASE_URL is set (Supabase, Railway, etc),
 * otherwise an embedded PGlite database in ./data so the app runs with no setup.
 * The same Drizzle schema and SQL migrations apply to both.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { env } from "../env";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __songDb?: Promise<Db> };

/** Counts NOTICEs Postgres sends (e.g. "already exists, skipping" from each idempotent migration). */
let noticeCount = 0;

/**
 * postgres.js prints every NoticeResponse to stdout as a multi-line object unless `onnotice` is
 * set. On an already-migrated database that is one per migration statement, enough to hit
 * Railway's log rate limit and drop real startup messages. NOTICE/INFO/LOG/DEBUG are only
 * counted; WARNINGs still get one line. Errors are not notices: they reject the query as usual.
 */
export function handleNotice(n: { severity?: string; severity_local?: string; code?: string; message?: string }): void {
  const severity = (n.severity ?? n.severity_local ?? "").toUpperCase();
  if (severity === "WARNING") {
    console.warn(`[db] Postgres warning${n.code ? ` ${n.code}` : ""}: ${n.message ?? "(no message)"}`);
    return;
  }
  noticeCount++;
}

async function create(): Promise<Db> {
  const migrations = fs.readFileSync(path.join(process.cwd(), "src/lib/db/migrations.sql"), "utf8");
  let db: Db;
  if (env.databaseUrl) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(env.databaseUrl, { max: 5, prepare: false, onnotice: handleNotice });
    db = drizzle(client, { schema }) as unknown as Db;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    // PGLITE_DATA_DIR=memory:// gives an isolated in-memory database (used by tests).
    const dir = env.pgliteDataDir || path.join(process.cwd(), "data/pglite");
    if (!dir.startsWith("memory://")) fs.mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    db = drizzle(client, { schema }) as unknown as Db;
  }
  // Idempotent: every statement is CREATE ... IF NOT EXISTS.
  // (PGlite only prints notices with debug > 0, so that path is quiet already.)
  const statements = migrations.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  const noticesBefore = noticeCount;
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
  const skipped = noticeCount - noticesBefore;
  if (skipped > 0) console.log(`[db] migrations: ${statements.length} statements run, ${skipped} already applied`);
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__songDb) globalForDb.__songDb = create();
  return globalForDb.__songDb;
}

export { schema };

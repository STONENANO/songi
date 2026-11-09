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

async function create(): Promise<Db> {
  const migrations = fs.readFileSync(path.join(process.cwd(), "src/lib/db/migrations.sql"), "utf8");
  let db: Db;
  if (env.databaseUrl) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(env.databaseUrl, { max: 5, prepare: false });
    db = drizzle(client, { schema }) as unknown as Db;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = path.join(process.cwd(), "data/pglite");
    fs.mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    db = drizzle(client, { schema }) as unknown as Db;
  }
  // Idempotent: every statement is CREATE ... IF NOT EXISTS.
  for (const stmt of migrations.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(stmt));
  }
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__songDb) globalForDb.__songDb = create();
  return globalForDb.__songDb;
}

export { schema };

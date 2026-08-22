// Boot-time migration runner (decisions.md #12): numbered .sql files
// in ./migrations, applied in filename order, each inside its own
// transaction, tracked in applied_migrations so a file runs exactly
// once. Runs on every server start — Render's free tier has no
// pre-deploy step, and locally this is how a fresh brew Postgres gets
// its tables on first boot.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

// Fixed app-specific key: concurrent boots (e.g. a redeploy overlap)
// take turns instead of racing to apply the same file.
const ADVISORY_LOCK_KEY = 727274;

/** Applies pending migrations; returns the filenames it applied. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS applied_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = new Set<string>(
      (await client.query("SELECT name FROM applied_migrations")).rows.map(
        (row: { name: string }) => row.name,
      ),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO applied_migrations (name) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
      } catch (cause) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed`, { cause });
      }
      applied.push(file);
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
  return applied;
}

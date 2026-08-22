import pg from "pg";

// The pool exists only when DATABASE_URL is configured, so the app
// boots (and hello-world deploys) before any database is provisioned.
// It's built here and passed around explicitly — tests build their
// own pool against the test database and inject it the same way.
export function createPool(): pg.Pool | null {
  return process.env.DATABASE_URL
    ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
    : null;
}

export type DbStatus = "connected" | "error" | "not_configured";

export async function checkDb(pool: pg.Pool | null): Promise<DbStatus> {
  if (!pool) return "not_configured";
  try {
    await pool.query("SELECT 1");
    return "connected";
  } catch {
    return "error";
  }
}

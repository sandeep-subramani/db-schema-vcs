import pg from "pg";

// The pool exists only when DATABASE_URL is configured, so the app
// boots (and hello-world deploys) before any database is provisioned.
export const pool: pg.Pool | null = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export type DbStatus = "connected" | "error" | "not_configured";

export async function checkDb(): Promise<DbStatus> {
  if (!pool) return "not_configured";
  try {
    await pool.query("SELECT 1");
    return "connected";
  } catch {
    return "error";
  }
}

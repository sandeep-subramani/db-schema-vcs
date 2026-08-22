import "./env.ts";
import { createApp } from "./app.ts";
import { createPool } from "./db.ts";
import { migrate } from "./migrate.ts";

const port = Number(process.env.PORT ?? 3000);
const pool = createPool();

if (pool) {
  // Migrate before listening (decisions.md #12): the free tier has no
  // pre-deploy step, so new code never serves requests against old
  // tables.
  const applied = await migrate(pool);
  if (applied.length > 0) {
    console.log(`applied migrations: ${applied.join(", ")}`);
  }
} else {
  console.warn("DATABASE_URL not set — data API disabled, /api/health still up");
}

createApp(pool).listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});

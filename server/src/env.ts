// Loads the repo-root .env into process.env — imported first (and
// only) by index.ts, before anything reads configuration. On Render
// there is no .env file and the environment is already set.

import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"),
  );
} catch {
  // No .env file — expected in production.
}

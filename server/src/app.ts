import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type pg from "pg";
import { createApi } from "./api.ts";
import { checkDb } from "./db.ts";

const clientDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../client/dist",
);

export function createApp(pool: pg.Pool | null): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    res.json({ status: "ok", db: await checkDb(pool) });
  });

  if (pool) {
    app.use("/api", createApi(pool));
  } else {
    // Boots-before-database property from the scaffold: health above
    // still answers, everything else says plainly what's missing.
    app.use("/api", (_req, res) => {
      res.status(503).json({ error: "No database configured — set DATABASE_URL" });
    });
  }

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(clientDist));
    // SPA fallback as middleware — bare "*" route patterns broke in
    // Express 5.
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        res.sendFile(path.join(clientDist, "index.html"));
      } else {
        next();
      }
    });
  }

  // Every failure leaves as JSON: malformed request bodies as a 400,
  // anything unexpected as a logged 500 — never an HTML stack trace.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ error: "Request body isn't valid JSON" });
        return;
      }
      // body-parser errors carry their own 4xx status (e.g. 413 for a
      // body over the 1MB limit) — forward those instead of calling a
      // request that can never succeed a server error.
      const status = (error as { status?: unknown }).status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        res.status(status).json({
          error:
            status === 413
              ? "Request body too large — the limit is 1MB"
              : "Couldn't read the request body",
        });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Something broke on the server — try again" });
    },
  );

  return app;
}

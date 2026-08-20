import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { checkDb } from "./db.ts";

const clientDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../client/dist",
);

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    res.json({ status: "ok", db: await checkDb() });
  });

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

  return app;
}

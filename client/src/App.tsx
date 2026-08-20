import { useEffect, useState } from "react";

type Health = { status: string; db: "connected" | "error" | "not_configured" };

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; health: Health }
  | { kind: "unreachable" };

const DB_LABELS: Record<Health["db"], string> = {
  connected: "database connected",
  error: "database configured but unreachable",
  not_configured: "no database configured yet",
};

export function App() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((health: Health) => {
        if (!cancelled) setState({ kind: "ok", health });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "unreachable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1>Schema Version Control</h1>
      <p className="tagline">
        Branch, diff, and merge database schemas — like git, for your tables.
      </p>
      {state.kind === "loading" && <p className="status">Checking server…</p>}
      {state.kind === "ok" && (
        <p className="status status--ok">
          Server is up · {DB_LABELS[state.health.db]}
        </p>
      )}
      {state.kind === "unreachable" && (
        <p className="status status--bad">
          Can’t reach the server. If you’re running locally, start it with{" "}
          <code>npm run dev</code>.
        </p>
      )}
    </main>
  );
}

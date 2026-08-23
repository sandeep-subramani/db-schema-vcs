import { useEffect, useState } from "react";

// One quiet line at the bottom of every screen saying whether the
// server and its database are reachable — the difference between "my
// save failed" mysteries and an obvious cause.

type Health = { status: string; db: "connected" | "error" | "not_configured" };

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; health: Health }
  | { kind: "unreachable" };

const DB_LABELS: Record<Health["db"], string> = {
  connected: "database connected",
  error: "database configured but unreachable",
  not_configured: "no database configured — nothing can be saved",
};

export function HealthFooter() {
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
    <footer className="foot">
      {state.kind === "loading" && <span>Checking server…</span>}
      {state.kind === "ok" && (
        <span className={state.health.db === "connected" ? "foot--ok" : "foot--bad"}>
          <span className="foot-dot" aria-hidden="true" />
          Server is up · {DB_LABELS[state.health.db]}
        </span>
      )}
      {state.kind === "unreachable" && (
        <span className="foot--bad">
          <span className="foot-dot" aria-hidden="true" />
          Can't reach the server — start it with <code>npm run dev</code>.
        </span>
      )}
    </footer>
  );
}

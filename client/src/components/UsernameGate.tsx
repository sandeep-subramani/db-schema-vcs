import { useState } from "react";
import { api, ApiError } from "../api.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

// The whole login flow (decisions.md #13): claim a name, get a
// cookie-free identity. The card says out loud that there's no
// password — honesty is part of the demo.
export function UsernameGate({ onClaimed }: { onClaimed: (username: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      onClaimed(await api.claimUser(value));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong — try again");
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-theme">
        <ThemeToggle />
      </div>

      <div className="gate-hero">
        <h1>
          <span className="gate-gem" aria-hidden="true" />
          Schema Version Control
        </h1>
        <p className="gate-lead">
          Branch a database schema, evolve it, diff it, merge it back.
        </p>

        {/* Decorative branch/merge vignette — pure presentation. */}
        <div className="gate-diagram" aria-hidden="true">
          <span className="diagram-pill" style={{ top: 0 }}>
            Branch point
          </span>
          <span className="diagram-rail" />
          <span className="diagram-branch diagram-branch--main">
            <span className="diagram-branch-dot" /> main
          </span>
          <span className="diagram-branch diagram-branch--feature">
            feature <span className="diagram-branch-dot" />
          </span>
          <span className="diagram-node" style={{ top: "7.4rem" }} />
          <span
            className="diagram-link"
            style={{ top: "7.35rem", right: "calc(50% + 0.6rem)", width: "2.6rem" }}
          />
          <span className="diagram-chip diagram-chip--left" style={{ top: "7.4rem" }}>
            <span className="op-changed">±</span> users.email
          </span>
          <span className="diagram-node diagram-node--feature" style={{ top: "11.2rem" }} />
          <span
            className="diagram-link diagram-link--feature"
            style={{ top: "11.15rem", left: "calc(50% + 0.6rem)", width: "2.6rem" }}
          />
          <span className="diagram-chip diagram-chip--right" style={{ top: "11.2rem" }}>
            <span className="op-added">+</span> invoices
            <span className="diagram-badge">Added</span>
          </span>
          <span className="diagram-pill diagram-pill--merge">Merge</span>
        </div>

        <ul className="gate-points">
          <li className="gate-point">
            <span className="gate-point-icon" aria-hidden="true">
              ↳
            </span>
            <p>
              <strong>Branch</strong> <span>— work on a copy without touching “main”</span>
            </p>
          </li>
          <li className="gate-point">
            <span className="gate-point-icon gate-point-icon--warn" aria-hidden="true">
              ±
            </span>
            <p>
              <strong>Diff</strong> <span>— every change reads against the branch point</span>
            </p>
          </li>
          <li className="gate-point">
            <span className="gate-point-icon" aria-hidden="true">
              »
            </span>
            <p>
              <strong>Merge</strong> <span>— pick a side per conflict; the schema stays valid</span>
            </p>
          </li>
        </ul>
      </div>

      <form
        className="gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !busy) void claim();
        }}
      >
        <label className="gate-card-title" htmlFor="gate-username">
          Pick a username
        </label>
        <input
          id="gate-username"
          autoFocus
          value={value}
          placeholder="e.g. sandeep"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        <p className="gate-hint">
          Lowercase letters, digits, dashes or underscores. No password — this
          is a demo identity, so anyone typing your name is you. Repos you
          create or join follow this name.
        </p>
        {value.trim() !== "" && (
          <p className="gate-identity">
            You’ll appear as
            <span className="user-chip gate-identity-chip">
              <span className="user-chip-avatar" aria-hidden="true">
                {value.trim().charAt(0).toUpperCase()}
              </span>
              <span className="gate-identity-name">{value.trim()}</span>
            </span>
          </p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn--primary gate-submit"
          disabled={value.trim() === "" || busy}
        >
          {busy ? "One sec…" : "Continue"}
        </button>
      </form>
    </div>
  );
}

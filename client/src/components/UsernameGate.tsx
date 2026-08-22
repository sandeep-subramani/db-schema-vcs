import { useState } from "react";
import { api, ApiError } from "../api.ts";

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
      <form
        className="gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !busy) void claim();
        }}
      >
        <h1>Schema Version Control</h1>
        <p className="gate-lead">
          Branch a database schema, evolve it, diff it, merge it back.
        </p>
        <label className="prompt-label">
          Pick a username
          <input
            autoFocus
            value={value}
            placeholder="e.g. sandeep"
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
        </label>
        <p className="dialog-hint">
          Lowercase letters, digits, dashes or underscores. No password — this
          is a demo identity, so anyone typing your name is you. Repos you
          create or join follow this name.
        </p>
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

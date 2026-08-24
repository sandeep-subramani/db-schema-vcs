import { useEffect, useState } from "react";
import { api, ApiError, type Repo } from "../api.ts";

// Sharing = appending a username to the repo's member list
// (decisions.md #13). Any member can add others; the server insists
// the name has been claimed, and the error explains what to do.
export function MembersDialog({
  repo,
  username,
  onUpdated,
  onClose,
}: {
  repo: Repo;
  username: string;
  onUpdated: (repo: Repo) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.addMember(repo.id, value));
      setValue("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add them — try again");
    } finally {
      setBusy(false);
    }
  }

  const people = [
    { name: repo.owner, role: "owner" },
    ...repo.members.map((name) => ({ name, role: "member" })),
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Who can work on ${repo.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Who can work on “{repo.name}”</h2>
        <ul className="member-list">
          {people.map((person) => (
            <li key={person.name}>
              <span className="member-avatar" aria-hidden="true">
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="member-name">
                {person.name}
                {person.name === username && " (you)"}
              </span>
              <span className={`member-role member-role--${person.role}`}>
                {person.role}
              </span>
            </li>
          ))}
        </ul>
        <form
          className="add-form add-form--row"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && !busy) void add();
          }}
        >
          <input
            value={value}
            placeholder="username to add"
            aria-label="Username to add"
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          <button
            type="submit"
            className="btn btn--accent-soft"
            disabled={value.trim() === "" || busy}
          >
            {busy ? "Adding…" : "Add member"}
          </button>
        </form>
        <p className="dialog-hint">
          Members see this repo on their home screen and can edit, save,
          branch and commit — every branch is shared.
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, ApiError, type Repo } from "../api.ts";
import { timeAgo } from "../time.ts";
import { TextPromptDialog } from "./TextPromptDialog.tsx";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; repos: Repo[] }
  | { kind: "error"; message: string };

// Home screen: every repo you own or joined (decisions.md #13), a
// "+" up top to start a new one. Opening a new repo drops you on its
// first-commit gate (decisions.md #14).
export function RepoList({
  username,
  onOpen,
}: {
  username: string;
  onOpen: (repoId: number) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listRepos()
      .then((repos) => {
        if (!cancelled) setState({ kind: "ready", repos });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: e instanceof ApiError ? e.message : "Couldn't load your repos",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function create(name: string) {
    setBusy(true);
    setCreateError(null);
    try {
      const { repo } = await api.createRepo(name);
      onOpen(repo.id);
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Couldn't create the repo");
      setBusy(false);
    }
  }

  return (
    <main className="repo-home">
      <div className="repo-home-head">
        <h2>Your repos</h2>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setCreateError(null);
            setCreating(true);
          }}
        >
          + New repo
        </button>
      </div>

      {state.kind === "loading" && <p className="empty">Loading your repos…</p>}

      {state.kind === "error" && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === "ready" && state.repos.length === 0 && (
        <div className="empty empty--main">
          <h2>No repos yet</h2>
          <p>
            A repo holds one schema and its whole branch history. Create your
            first one — you'll get a <code>main</code> branch and a choice of
            ways to bring a schema in.
          </p>
        </div>
      )}

      {state.kind === "ready" && state.repos.length > 0 && (
        <ul className="repo-list">
          {state.repos.map((repo) => (
            <li key={repo.id}>
              <button type="button" className="repo-row" onClick={() => onOpen(repo.id)}>
                <span className="repo-row-name">{repo.name}</span>
                <span className="repo-row-meta">
                  {repo.owner === username ? "yours" : `by ${repo.owner}`}
                  {repo.members.length > 0 &&
                    ` · shared with ${repo.members.length} ${
                      repo.members.length === 1 ? "person" : "people"
                    }`}
                  {` · created ${timeAgo(repo.createdAt)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <TextPromptDialog
          title="New repo"
          label="Repo name"
          placeholder="e.g. web-shop"
          submitLabel="Create repo"
          hint="You'll start on a main branch with an empty schema."
          error={createError}
          busy={busy}
          onSubmit={(name) => void create(name)}
          onCancel={() => setCreating(false)}
        />
      )}
    </main>
  );
}

import type { CommitMeta } from "../api.ts";
import { timeAgo } from "../time.ts";

// Linear history of the current branch, newest first (decisions.md
// #7). Read-only for now — the diff view between versions is the
// day-2 deliverable and will hang off these rows.
export function HistoryPanel({ commits }: { commits: CommitMeta[] }) {
  return (
    <aside className="history">
      <h2 className="sidebar-title">History</h2>
      {commits.length === 0 ? (
        <p className="empty empty--sidebar">
          No commits yet. A commit stamps the saved schema into this branch's
          history — use <strong>Commit…</strong> when the schema is worth
          keeping.
        </p>
      ) : (
        <ol className="commit-list">
          {commits.map((commit) => (
            <li key={commit.id}>
              <span className="commit-message">{commit.message}</span>
              <span className="commit-meta">
                {commit.author} · {timeAgo(commit.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

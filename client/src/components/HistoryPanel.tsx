import type { CommitMeta } from "../api.ts";
import { timeAgo } from "../time.ts";

// Linear history of the current branch, newest first (decisions.md
// #7). Each commit opens its diff against its predecessor; the oldest
// commit of a branch with a parent is the copied split-point commit
// (decisions.md #16), flagged here and rendered as a branch-point
// marker instead of a diff.
export function HistoryPanel({
  commits,
  selectedId,
  branchPointId,
  parentName,
  onSelect,
}: {
  commits: CommitMeta[];
  /** Commit whose diff is open, to highlight its row. */
  selectedId: number | null;
  /** Oldest commit's id when this branch split from a parent. */
  branchPointId: number | null;
  parentName: string | null;
  onSelect: (commit: CommitMeta) => void;
}) {
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
        <>
          <p className="history-hint">Click a commit to see what it changed.</p>
          <ol className="commit-list">
            {commits.map((commit) => (
              <li key={commit.id}>
                <button
                  type="button"
                  className={
                    commit.id === selectedId ? "commit-row selected" : "commit-row"
                  }
                  onClick={() => onSelect(commit)}
                  title={
                    commit.id === branchPointId && parentName
                      ? `Where this branch split from “${parentName}”`
                      : undefined
                  }
                >
                  <span className="commit-message">
                    {commit.message}
                    {commit.id === branchPointId && (
                      <span className="commit-badge">branch point</span>
                    )}
                  </span>
                  <span className="commit-meta">
                    {commit.author} · {timeAgo(commit.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

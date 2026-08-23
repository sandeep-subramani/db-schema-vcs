import type { Branch } from "../api.ts";
import { timeAgo } from "../time.ts";

// Branch-level controls in one row: where you are, where you can go,
// and the save/commit state of what you're looking at. The select
// indents children under parents — the branch tree of decisions.md #7
// read as an outline.
export function BranchBar({
  branches,
  currentId,
  dirty,
  savedBy,
  savedAt,
  saving,
  commitCount,
  historyOpen,
  reviewOpen,
  canBranch,
  parentName,
  mergeOpen,
  canCompare,
  compareOpen,
  canCommit,
  onSwitch,
  onNewBranch,
  onSave,
  onCommit,
  onToggleHistory,
  onToggleReview,
  onToggleMerge,
  onToggleCompare,
}: {
  branches: Branch[];
  currentId: number;
  dirty: boolean;
  savedBy: string | null;
  savedAt: string | null;
  saving: boolean;
  commitCount: number;
  historyOpen: boolean;
  /** True while the "changes since last commit" diff is on screen. */
  reviewOpen: boolean;
  /** False until some branch has a commit to split at (decisions.md #16). */
  canBranch: boolean;
  /** Parent branch's name — merge goes there (decisions.md #7, #20);
   *  null on a root branch, which has nowhere to merge into. */
  parentName: string | null;
  mergeOpen: boolean;
  /** False until some branch has a commit — nothing to compare before that. */
  canCompare: boolean;
  compareOpen: boolean;
  /** False on an empty branch with no commits — an empty first commit
   *  would only dismiss the gate, so bring a schema in first. */
  canCommit: boolean;
  onSwitch: (branchId: number) => void;
  onNewBranch: () => void;
  onSave: () => void;
  onCommit: () => void;
  onToggleHistory: () => void;
  onToggleReview: () => void;
  onToggleMerge: () => void;
  onToggleCompare: () => void;
}) {
  // Depth for indentation: walk parent pointers (the tree is small).
  const byId = new Map(branches.map((b) => [b.id, b]));
  function depth(branch: Branch): number {
    let d = 0;
    let current = branch;
    while (current.parentBranchId !== null && byId.has(current.parentBranchId)) {
      current = byId.get(current.parentBranchId)!;
      d += 1;
    }
    return d;
  }
  // Order as a tree: parents before children, siblings by id.
  const ordered: Branch[] = [];
  function addChildren(parentId: number | null) {
    for (const branch of branches) {
      if (branch.parentBranchId === parentId && !ordered.includes(branch)) {
        ordered.push(branch);
        addChildren(branch.id);
      }
    }
  }
  addChildren(null);
  // Safety net: anything unreachable (shouldn't happen) still shows.
  for (const branch of branches) {
    if (!ordered.includes(branch)) ordered.push(branch);
  }

  const saveStatus = dirty
    ? "Unsaved changes"
    : savedAt
      ? `Saved ${timeAgo(savedAt)}${savedBy ? ` by ${savedBy}` : ""}`
      : "No saves on this branch yet";

  return (
    <div className="branchbar">
      <label className="branch-pick">
        <span className="branch-label">Branch</span>
        <span className="branch-pill">
          <span className="branch-pill-dot" aria-hidden="true" />
            <select
            value={currentId}
            aria-label="Switch branch"
            onChange={(e) => onSwitch(Number(e.target.value))}
          >
            {ordered.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {`${"  ".repeat(depth(branch))}${branch.name}`}
              </option>
            ))}
          </select>
        </span>
      </label>
      <button
        type="button"
        className="btn"
        onClick={onNewBranch}
        disabled={!canBranch}
        title={
          canBranch
            ? undefined
            : "A branch splits at a commit — make the first commit before branching"
        }
      >
        + New branch
      </button>
      {parentName !== null && (
        <button
          type="button"
          className={mergeOpen ? "btn btn--toggled" : "btn"}
          onClick={onToggleMerge}
          title={`Merge this branch's last commit into “${parentName}”`}
        >
          Merge into “{parentName}”…
        </button>
      )}

      <span className={dirty ? "save-status save-status--dirty" : "save-status"}>
        {dirty && <span className="dirty-dot" aria-hidden="true" />}
        {saving ? "Saving…" : saveStatus}
      </span>

      <div className="branchbar-actions">
        <button
          type="button"
          className={reviewOpen ? "btn btn--toggled" : "btn"}
          onClick={onToggleReview}
          disabled={commitCount === 0}
          title={
            commitCount === 0
              ? "Make the first commit, then review changes against it"
              : "Compare the schema on screen with the last commit"
          }
        >
          Review changes
        </button>
        <button type="button" className="btn" onClick={onSave} disabled={!dirty || saving}>
          Save
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onCommit}
          disabled={saving || !canCommit}
          title={
            canCommit
              ? undefined
              : "Nothing to commit yet — bring a schema in first"
          }
        >
          Commit…
        </button>
        <button
          type="button"
          className={compareOpen ? "btn btn--toggled" : "btn"}
          onClick={onToggleCompare}
          disabled={!canCompare}
          title={
            canCompare
              ? "Compare any two commits, across branches"
              : "Nothing committed yet — commit first, then compare versions"
          }
        >
          Compare…
        </button>
        <button
          type="button"
          className={historyOpen ? "btn btn--toggled" : "btn"}
          onClick={onToggleHistory}
        >
          History
          <span className="count-badge">{commitCount}</span>
        </button>
      </div>
    </div>
  );
}

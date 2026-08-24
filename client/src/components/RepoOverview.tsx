import type { Schema } from "engine";
import type { Branch, CommitMeta, Repo } from "../api.ts";
import { timeAgo } from "../time.ts";

// The repo home: what this repo is, what's in it, and who else is in
// it — read entirely off data RepoScreen has already fetched. It owns
// no state and makes no requests; every number here is counted from
// the snapshot, the branch list or the commit list in hand.
//
// One button leaves it: Edit, which opens the entry doors
// (decisions.md #29). Importing used to have a button here and
// another in the topbar; both are gone, and export is the only
// schema action left on the rail.
//
// Deliberately absent, because each one costs a request-per-commit, a
// request-per-branch, a new endpoint or a migration: per-table "last
// changed", a cross-branch commit feed, a repo description, per-branch
// conflict badges, and Delete repo.

/** "3 columns · PK (order_id, product_id) · 2 foreign keys" */
function shapeOf(table: Schema["tables"][number]): string {
  const parts = [`${table.columns.length} ${table.columns.length === 1 ? "column" : "columns"}`];
  const pk = table.primaryKey ?? [];
  if (pk.length === 1) parts.push(`PK ${pk[0]}`);
  else if (pk.length > 1) parts.push(`PK (${pk.join(", ")})`);
  const fks = table.foreignKeys?.length ?? 0;
  if (fks > 0) parts.push(`${fks} foreign ${fks === 1 ? "key" : "keys"}`);
  return parts.join(" · ");
}

export function RepoOverview({
  repo,
  branches,
  currentBranch,
  schema,
  commits,
  savedBy,
  savedAt,
  dirty,
  onOpenDoors,
  onOpenLatestDiff,
  onSwitchBranch,
  onShare,
  onExportJson,
}: {
  repo: Repo | null;
  branches: Branch[];
  currentBranch: Branch | null;
  schema: Schema;
  commits: CommitMeta[];
  savedBy: string | null;
  savedAt: string | null;
  dirty: boolean;
  /** Opens the entry doors — the one way into the editor and both
   *  importers (decisions.md #29). */
  onOpenDoors: () => void;
  onOpenLatestDiff: () => void;
  onSwitchBranch: (branchId: number) => void;
  onShare: () => void;
  onExportJson: () => void;
}) {
  const columnCount = schema.tables.reduce((n, t) => n + t.columns.length, 0);
  const foreignKeyCount = schema.tables.reduce(
    (n, t) => n + (t.foreignKeys?.length ?? 0),
    0,
  );
  const latest = commits[0] ?? null;
  // repo.members excludes the owner, so the headcount adds them back —
  // the same convention the Share button uses.
  const memberCount = repo ? repo.members.length + 1 : 0;

  return (
    <div className="overview">
      <div className="overview-main">
        <header className="overview-head">
          <div className="overview-title">
            <h2>
              <span className="overview-gem" aria-hidden="true" />
              {repo?.name ?? "…"}
            </h2>
            {repo && repo.members.length > 0 && (
              <span className="overview-badge">
                Shared · {memberCount} members
              </span>
            )}
          </div>
          {/* One door out of the home, not three: hand editing, JSON
              import and SQL import all live behind it. */}
          <button type="button" className="btn btn--primary" onClick={onOpenDoors}>
            Edit
          </button>
        </header>

        {/* The last commit on this branch: a headline that opens the
            full diff against its predecessor — the same view a history
            row opens. With no commits there's nothing to open, so the
            empty state stays inert text. */}
        {latest ? (
          <button
            type="button"
            className="overview-latest overview-latest--clickable"
            onClick={onOpenLatestDiff}
            title="See what this commit changed"
          >
            <span className="overview-avatar" aria-hidden="true">
              {latest.author.slice(0, 1).toUpperCase()}
            </span>
            <span className="overview-latest-author">{latest.author}</span>
            <span className="overview-latest-message">{latest.message}</span>
            <span className="overview-latest-when">{timeAgo(latest.createdAt)}</span>
          </button>
        ) : (
          <div className="overview-latest">
            <span className="overview-latest-message overview-latest-message--empty">
              No commits on this branch yet — the schema here isn't stamped
              into history.
            </span>
          </div>
        )}

        <section className="overview-tables">
          <div className="overview-tables-head">
            <span>Table</span>
            <span>Shape</span>
          </div>
          {schema.tables.length === 0 ? (
            <p className="overview-empty">
              No tables on this branch. Hit Edit to add the first one.
            </p>
          ) : (
            <ul className="overview-table-rows">
              {schema.tables.map((table) => (
                <li key={table.name} className="overview-table-row">
                  <span className="overview-table-name">{table.name}</span>
                  <span className="overview-table-shape">{shapeOf(table)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="overview-branches">
          <div className="overview-section-head">
            <h3>Branches</h3>
            <span className="count-badge">{branches.length}</span>
          </div>
          <div className="overview-branch-grid">
            {branches.map((branch) => {
              const isCurrent = branch.id === currentBranch?.id;
              return (
                <div
                  key={branch.id}
                  className={
                    isCurrent
                      ? "overview-branch-card overview-branch-card--current"
                      : "overview-branch-card"
                  }
                >
                  <div className="overview-branch-title">
                    <span className="overview-branch-dot" aria-hidden="true" />
                    <span className="overview-branch-name">{branch.name}</span>
                    {branch.parentBranchId === null && (
                      <span className="overview-tag">Default</span>
                    )}
                    {isCurrent && <span className="overview-tag">Current</span>}
                  </div>
                  <p className="overview-branch-meta">
                    {branch.commitCount}{" "}
                    {branch.commitCount === 1 ? "commit" : "commits"}
                    {branch.savedAt !== null && (
                      <>
                        {" · updated "}
                        {timeAgo(branch.savedAt)}
                        {branch.savedBy !== null && ` by ${branch.savedBy}`}
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onSwitchBranch(branch.id)}
                    disabled={isCurrent}
                  >
                    {isCurrent ? "You're here" : "Open"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <aside className="overview-rail">
        <section className="overview-panel">
          <h3>This branch</h3>
          <dl className="overview-stats">
            <div>
              <dt>Tables</dt>
              <dd>{schema.tables.length}</dd>
            </div>
            <div>
              <dt>Columns</dt>
              <dd>{columnCount}</dd>
            </div>
            <div>
              <dt>Foreign keys</dt>
              <dd>{foreignKeyCount}</dd>
            </div>
            <div>
              <dt>Commits</dt>
              <dd>{currentBranch?.commitCount ?? 0}</dd>
            </div>
          </dl>
          <p className="overview-saved">
            {dirty
              ? "Unsaved changes on screen"
              : savedAt !== null
                ? `Saved ${timeAgo(savedAt)}${savedBy ? ` by ${savedBy}` : ""}`
                : "No saves on this branch yet"}
          </p>
        </section>

        <section className="overview-panel">
          <div className="overview-section-head">
            <h3>Members</h3>
            <span className="count-badge">{memberCount}</span>
          </div>
          <ul className="overview-members">
            {repo && (
              <li>
                <span className="overview-avatar" aria-hidden="true">
                  {repo.owner.slice(0, 1).toUpperCase()}
                </span>
                <span className="overview-member-name">{repo.owner}</span>
                <span className="overview-tag">Owner</span>
              </li>
            )}
            {repo?.members.map((member) => (
              <li key={member}>
                <span className="overview-avatar" aria-hidden="true">
                  {member.slice(0, 1).toUpperCase()}
                </span>
                <span className="overview-member-name">{member}</span>
              </li>
            ))}
          </ul>
          {/* Adding a member keeps its one home in the Share dialog —
              a second copy of that form would mean a second copy of
              its error handling. */}
          <button type="button" className="btn overview-wide-btn" onClick={onShare}>
            Add a member
          </button>
        </section>

        <section className="overview-panel">
          <h3>Schema</h3>
          {/* Import lives behind Edit now; export is the odd one out —
              it takes a schema away rather than bringing one in, so it
              keeps its own button here. */}
          <div className="overview-actions">
            <button type="button" className="btn overview-wide-btn" onClick={onExportJson}>
              Export JSON
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}

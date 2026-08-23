// The first-commit gate (decisions.md #14): a brand-new branch with
// nothing in it opens on its entry doors instead of a blank editor.
export function FirstCommitGate({
  branchName,
  onStartEditing,
  onImportJson,
  onImportSql,
  onLoadExample,
}: {
  branchName: string;
  onStartEditing: () => void;
  onImportJson: () => void;
  onImportSql: () => void;
  onLoadExample: () => void;
}) {
  return (
    <div className="first-commit">
      <h2>
        Bring your schema into{" "}
        <span className="first-commit-quote">“</span>
        <span className="first-commit-branch">{branchName}</span>
        <span className="first-commit-quote">”</span>
      </h2>
      <p className="first-commit-lead">
        This branch is empty. Get a schema in, shape it, then make your first
        commit — that's the version everything else builds on.
      </p>
      <div className="door-grid">
        <button type="button" className="door" onClick={onStartEditing}>
          <span className="door-icon" aria-hidden="true">
            +
          </span>
          <span className="door-title">Build it in the editor</span>
          <span className="door-desc">
            Start from zero: add tables, columns, keys and constraints by hand.
          </span>
        </button>
        <button type="button" className="door" onClick={onImportJson}>
          <span className="door-icon door-icon--json" aria-hidden="true">
            &#123;&nbsp;&#125;
          </span>
          <span className="door-title">Upload or paste JSON</span>
          <span className="door-desc">
            Bring in a schema snapshot — the format Export produces.
          </span>
        </button>
        <button type="button" className="door" onClick={onImportSql}>
          <span className="door-icon" aria-hidden="true">
            &gt;_
          </span>
          <span className="door-title">
            Paste SQL <span className="badge-tag">Postgres</span>
          </span>
          <span className="door-desc">
            Paste CREATE TABLE statements or a pg_dump file from a real
            Postgres database. More dialects later.
          </span>
        </button>
      </div>
      {/* The commit you don't have yet: the branch line runs down from
          the doors into a hollow ring — filled once you commit. */}
      <div className="first-commit-node">
        <span className="fc-node-line" aria-hidden="true" />
        <span className="fc-node-ring" aria-hidden="true" />
        <span className="fc-node-label">Your first commit on {branchName}</span>
      </div>
      <p className="first-commit-example">
        Just exploring?{" "}
        <button type="button" className="link-btn" onClick={onLoadExample}>
          Load the example schema
        </button>{" "}
        — a small web shop you can poke at.
      </p>
    </div>
  );
}

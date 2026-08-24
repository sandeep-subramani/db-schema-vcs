// The entry doors (decisions.md #14, #29): every way to get a schema
// into this branch, in one place. Two jobs, one component:
//   - a brand-new branch with nothing in it opens here instead of a
//     blank editor (the original first-commit gate)
//   - "Edit" on the repo home comes here too, so importing and hand
//     editing stop being three buttons scattered across the chrome
// `hasSchema` picks the copy: an empty branch is being filled, a
// branch with tables or commits is being changed — and on that second
// reading the doors replace rather than seed, so the framing has to
// say so and the example-schema shortcut has no business being there.
export function FirstCommitGate({
  branchName,
  hasSchema,
  onStartEditing,
  onImportJson,
  onImportSql,
  onLoadExample,
  onCancel,
}: {
  branchName: string;
  /** True when this branch already has tables or commits. */
  hasSchema: boolean;
  onStartEditing: () => void;
  onImportJson: () => void;
  onImportSql: () => void;
  onLoadExample: () => void;
  /** The way back to the repo home — absent on the automatic gate,
   *  which is the landing for an empty branch and has nothing behind
   *  it to go back to. */
  onCancel?: () => void;
}) {
  return (
    <div className="first-commit">
      <h2>
        {hasSchema ? "Change the schema on " : "Bring your schema into "}
        <span className="first-commit-quote">“</span>
        <span className="first-commit-branch">{branchName}</span>
        <span className="first-commit-quote">”</span>
      </h2>
      <p className="first-commit-lead">
        {hasSchema
          ? "Pick how you want to change it. Nothing here touches history on its own — you still save, then commit."
          : "This branch is empty. Get a schema in, shape it, then make your first commit — that's the version everything else builds on."}
      </p>
      <div className="door-grid">
        <button type="button" className="door" onClick={onStartEditing}>
          <span className="door-icon" aria-hidden="true">
            +
          </span>
          <span className="door-title">
            {hasSchema ? "Open the editor" : "Build it in the editor"}
          </span>
          <span className="door-desc">
            {hasSchema
              ? "Add, rename or remove tables, columns, keys and constraints by hand."
              : "Start from zero: add tables, columns, keys and constraints by hand."}
          </span>
        </button>
        <button type="button" className="door" onClick={onImportJson}>
          <span className="door-icon door-icon--json" aria-hidden="true">
            &#123;&nbsp;&#125;
          </span>
          <span className="door-title">
            {hasSchema ? "Replace from JSON" : "Upload or paste JSON"}
          </span>
          <span className="door-desc">
            {hasSchema
              ? "Swap in a schema snapshot — the format Export produces. Replaces what's on this branch."
              : "Bring in a schema snapshot — the format Export produces."}
          </span>
        </button>
        <button type="button" className="door" onClick={onImportSql}>
          <span className="door-icon" aria-hidden="true">
            &gt;_
          </span>
          <span className="door-title">
            {hasSchema ? "Replace from SQL" : "Paste SQL"}{" "}
            <span className="badge-tag">Postgres</span>
          </span>
          <span className="door-desc">
            {hasSchema
              ? "Paste CREATE TABLE statements or a pg_dump file. Replaces what's on this branch. More dialects later."
              : "Paste CREATE TABLE statements or a pg_dump file from a real Postgres database. More dialects later."}
          </span>
        </button>
      </div>
      {/* The commit you don't have yet: the branch line runs down from
          the doors into a hollow ring — filled once you commit. Only
          ever true of an empty branch. */}
      {!hasSchema && (
        <div className="first-commit-node">
          <span className="fc-node-line" aria-hidden="true" />
          <span className="fc-node-ring" aria-hidden="true" />
          <span className="fc-node-label">Your first commit on {branchName}</span>
        </div>
      )}
      {/* Loading the example replaces the whole schema, so it stays a
          shortcut for the empty branch it was written for. */}
      {!hasSchema && (
        <p className="first-commit-example">
          Just exploring?{" "}
          <button type="button" className="link-btn" onClick={onLoadExample}>
            Load the example schema
          </button>{" "}
          — a small web shop you can poke at.
        </p>
      )}
      {onCancel && (
        <p className="first-commit-back">
          <button type="button" className="link-btn" onClick={onCancel}>
            ← Back to the repo home
          </button>
        </p>
      )}
    </div>
  );
}

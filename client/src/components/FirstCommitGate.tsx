// The first-commit gate (decisions.md #14): a brand-new branch with
// nothing in it opens on its entry doors instead of a blank editor.
// The disabled SQL door is deliberate — a standing reminder that SQL
// import is committed scope (decisions.md #8), not a hidden gap.
export function FirstCommitGate({
  branchName,
  onStartEditing,
  onImportJson,
  onLoadExample,
}: {
  branchName: string;
  onStartEditing: () => void;
  onImportJson: () => void;
  onLoadExample: () => void;
}) {
  return (
    <div className="first-commit">
      <h2>Bring your schema into “{branchName}”</h2>
      <p className="first-commit-lead">
        This branch is empty. Get a schema in, shape it, then make your first
        commit — that's the version everything else builds on.
      </p>
      <div className="door-grid">
        <button type="button" className="door" onClick={onStartEditing}>
          <span className="door-title">Build it in the editor</span>
          <span className="door-desc">
            Start from zero: add tables, columns, keys and constraints by hand.
          </span>
        </button>
        <button type="button" className="door" onClick={onImportJson}>
          <span className="door-title">Upload or paste JSON</span>
          <span className="door-desc">
            Bring in a schema snapshot — the format Export produces.
          </span>
        </button>
        <button type="button" className="door" disabled title="SQL import is on the roadmap — not built yet">
          <span className="door-title">
            Paste SQL <span className="badge-soon">coming soon</span>
          </span>
          <span className="door-desc">
            Paste CREATE TABLE statements from a real database.
          </span>
        </button>
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

import { useEffect, useMemo, useRef, useState } from "react";
import { diffSchemas, type RenameDecision, type Schema } from "engine";
import { api, ApiError, type Branch, type CommitMeta } from "../api.ts";
import { timeAgo } from "../time.ts";
import { areBranchesRelated } from "../diff/related.ts";
import { buildDiffCards } from "../diff/view-model.ts";
import { DiffCardGrid } from "./DiffCardGrid.tsx";
import {
  describeRenameQuestion,
  RenameQuestionsBanner,
} from "./RenameQuestionsBanner.tsx";

// The arbitrary version picker (decisions.md #19, #21): any commit vs
// any commit, across branches. Pairs whose branches share no parent
// chain still render, but under an explicit banner and with rename
// questions suppressed — a rename question implies an edit history
// that doesn't exist between unrelated versions, so differences show
// as plain drop + add there.

interface SideSelection {
  branchId: number;
  /** null until a commit is picked (or auto-picked on branch load). */
  commitId: number | null;
}

export function CompareView({
  branches,
  initialBranchId,
  onClose,
}: {
  branches: Branch[];
  initialBranchId: number;
  onClose: () => void;
}) {
  const [from, setFrom] = useState<SideSelection>({
    branchId: initialBranchId,
    commitId: null,
  });
  const [to, setTo] = useState<SideSelection>({
    branchId: initialBranchId,
    commitId: null,
  });
  const [commitLists, setCommitLists] = useState<Record<number, CommitMeta[]>>({});
  const [snapshots, setSnapshots] = useState<Record<number, Schema>>({});
  const [decisions, setDecisions] = useState<RenameDecision[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch-once caches; refs de-dupe in-flight requests across renders.
  const pendingLists = useRef(new Set<number>());
  const pendingSnapshots = useRef(new Set<number>());

  useEffect(() => {
    let cancelled = false;
    for (const branchId of new Set([from.branchId, to.branchId])) {
      if (commitLists[branchId] || pendingLists.current.has(branchId)) continue;
      pendingLists.current.add(branchId);
      api
        .listCommits(branchId)
        .then((list) => {
          if (!cancelled) setCommitLists((cur) => ({ ...cur, [branchId]: list }));
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setError(e instanceof ApiError ? e.message : "Couldn't load that branch's history");
          }
        })
        .finally(() => pendingLists.current.delete(branchId));
    }
    return () => {
      cancelled = true;
    };
  }, [from.branchId, to.branchId, commitLists]);

  // A side with a branch but no commit picks one automatically: the
  // "to" side takes the newest, the "from" side the one before it —
  // so opening the view lands on "what did the last commit change".
  useEffect(() => {
    const fromList = commitLists[from.branchId];
    if (from.commitId === null && fromList && fromList.length > 0) {
      const pick = (fromList[1] ?? fromList[0])!.id;
      setFrom((cur) => (cur.commitId === null ? { ...cur, commitId: pick } : cur));
    }
    const toList = commitLists[to.branchId];
    if (to.commitId === null && toList && toList.length > 0) {
      const pick = toList[0]!.id;
      setTo((cur) => (cur.commitId === null ? { ...cur, commitId: pick } : cur));
    }
  }, [commitLists, from, to]);

  useEffect(() => {
    let cancelled = false;
    for (const commitId of [from.commitId, to.commitId]) {
      if (commitId === null) continue;
      if (snapshots[commitId] || pendingSnapshots.current.has(commitId)) continue;
      pendingSnapshots.current.add(commitId);
      api
        .getCommit(commitId)
        .then(({ snapshot }) => {
          if (!cancelled) setSnapshots((cur) => ({ ...cur, [commitId]: snapshot }));
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setError(e instanceof ApiError ? e.message : "Couldn't load that version");
          }
        })
        .finally(() => pendingSnapshots.current.delete(commitId));
    }
    return () => {
      cancelled = true;
    };
  }, [from.commitId, to.commitId, snapshots]);

  // Rename answers belong to one specific pair of versions.
  const pairKey = `${from.commitId ?? "-"}:${to.commitId ?? "-"}`;
  useEffect(() => {
    setDecisions([]);
  }, [pairKey]);

  const related = areBranchesRelated(branches, from.branchId, to.branchId);
  const fromSnapshot = from.commitId !== null ? snapshots[from.commitId] : undefined;
  const toSnapshot = to.commitId !== null ? snapshots[to.commitId] : undefined;

  const diff = useMemo(
    () =>
      fromSnapshot && toSnapshot
        ? diffSchemas(fromSnapshot, toSnapshot, related ? decisions : [])
        : null,
    [fromSnapshot, toSnapshot, related, decisions],
  );
  const cards = useMemo(
    () =>
      fromSnapshot && toSnapshot && diff
        ? buildDiffCards(fromSnapshot, toSnapshot, diff)
        : null,
    [fromSnapshot, toSnapshot, diff],
  );

  function swap() {
    const previousFrom = from;
    setFrom(to);
    setTo(previousFrom);
  }

  const sameCommit =
    from.commitId !== null && to.commitId !== null && from.commitId === to.commitId;
  const emptySide =
    commitLists[from.branchId]?.length === 0 || commitLists[to.branchId]?.length === 0;

  let body;
  if (error) {
    body = (
      <div className="empty empty--main">
        <h2>Can't compare these versions</h2>
        <p>{error}</p>
      </div>
    );
  } else if (emptySide) {
    body = (
      <div className="empty empty--main">
        <h2>No commits to compare</h2>
        <p>One of the picked branches has no commits yet — pick a branch with history on both sides.</p>
      </div>
    );
  } else if (sameCommit) {
    body = (
      <div className="empty empty--main">
        <h2>Same commit on both sides</h2>
        <p>Pick two different commits to see what changed between them.</p>
      </div>
    );
  } else if (!diff || !cards) {
    body = (
      <div className="empty empty--main">
        <p>Loading versions…</p>
      </div>
    );
  } else {
    body = (
      <>
        {!related && (
          <div className="compare-unrelated">
            <strong>Different branches:</strong> these two versions don't share
            a line of history, so this shows <em>what differs</em>, not what
            anyone did. Rename questions are off — a rename here appears as
            dropped + added.
          </div>
        )}
        {related && (
          <RenameQuestionsBanner
            title={`Possible ${diff.questions.length === 1 ? "rename" : "renames"} — you decide`}
            hint="A snapshot can't tell a rename from a drop + add. Until you answer, the pair below shows as dropped and added. Answers only shape this view — nothing is saved."
            items={diff.questions.map((question) => ({
              key: `${question.kind}:${question.from}:${question.to}`,
              text: describeRenameQuestion(question),
              answer: (rename: boolean) =>
                setDecisions((list) => [
                  ...list,
                  question.kind === "table"
                    ? { kind: "table", from: question.from, to: question.to, rename }
                    : {
                        kind: "column",
                        table: question.table,
                        from: question.from,
                        to: question.to,
                        rename,
                      },
                ])
            }))}
          />
        )}
        {diff.changes.length === 0 && diff.questions.length === 0 ? (
          <div className="empty empty--main">
            <h2>No differences</h2>
            <p>These two commits record the same schema.</p>
          </div>
        ) : (
          <DiffCardGrid cards={cards.cards} unchanged={cards.unchanged} />
        )}
      </>
    );
  }

  return (
    <main className="diff-view">
      <div className="diff-head">
        <button type="button" className="btn" onClick={onClose}>
          ← Editor
        </button>
        <div className="diff-title">
          <h2>Compare versions</h2>
          <p>Any commit against any commit, across branches.</p>
        </div>
      </div>
      <div className="compare-bar">
        <SidePicker
          label="From"
          selection={from}
          branches={branches}
          commits={commitLists[from.branchId]}
          onChange={setFrom}
        />
        <button type="button" className="btn compare-swap" onClick={swap} title="Swap sides">
          ⇄
        </button>
        <SidePicker
          label="To"
          selection={to}
          branches={branches}
          commits={commitLists[to.branchId]}
          onChange={setTo}
        />
      </div>
      {body}
    </main>
  );
}

function SidePicker({
  label,
  selection,
  branches,
  commits,
  onChange,
}: {
  label: string;
  selection: SideSelection;
  branches: Branch[];
  /** undefined while the branch's history is loading. */
  commits: CommitMeta[] | undefined;
  onChange: (next: SideSelection) => void;
}) {
  return (
    <div className="compare-group">
      <span className="compare-group-label">{label}</span>
      <label className="compare-field">
        Branch
        <select
          value={selection.branchId}
          onChange={(e) =>
            onChange({ branchId: Number(e.target.value), commitId: null })
          }
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <label className="compare-field">
        Commit
        <select
          value={selection.commitId ?? ""}
          disabled={!commits || commits.length === 0}
          onChange={(e) =>
            onChange({ ...selection, commitId: Number(e.target.value) })
          }
        >
          {!commits ? (
            <option value="">loading…</option>
          ) : commits.length === 0 ? (
            <option value="">no commits yet</option>
          ) : (
            commits.map((commit) => (
              <option key={commit.id} value={commit.id}>
                {commit.message} · {commit.author} · {timeAgo(commit.createdAt)}
              </option>
            ))
          )}
        </select>
      </label>
    </div>
  );
}

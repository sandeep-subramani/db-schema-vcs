import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  diffSchemas,
  mergeSchemas,
  type MergeConflict,
  type MergeQuestion,
  type MergeSide,
  type RenameDecision,
  type Schema,
} from "engine";
import { api, ApiError, type MergeContext } from "../api.ts";
import { buildDiffCards, buildMergeTimeline } from "../diff/view-model.ts";
import { DiffCard } from "./DiffCardGrid.tsx";
import {
  describeRenameQuestion,
  RenameQuestionsBanner,
} from "./RenameQuestionsBanner.tsx";

// The merge screen (decisions.md #20), opened on the branch being
// merged into its parent. The engine runs here in the client (same
// reasoning as the diff view, #19): rename answers and conflict picks
// re-run mergeSchemas instantly. Inputs are git-strict — both sides'
// working states must match their tips, and the screen funnels toward
// commit/switch when they don't. Applying saves the merged schema as
// the parent's working state; nothing commits until the user does.

/** What RepoScreen needs to remember after the merge lands: the
 *  marker for the eventual merge commit, and the parent-tip snapshot
 *  "Abandon merge" restores. In-memory only — a reload loses it, the
 *  corner decisions.md #20 accepts. */
export interface MergeLanding {
  parentBranchId: number;
  parentBranchName: string;
  sourceBranchId: number;
  sourceBranchName: string;
  mergedCommitId: number;
  restoreSnapshot: Schema;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; context: MergeContext };

export function MergeView({
  sourceBranchId,
  onClose,
  onRequestCommit,
  onSwitchToParent,
  onLanded,
  backLabel = "Editor",
}: {
  sourceBranchId: number;
  onClose: () => void;
  /** The source's saved work isn't committed — open the commit dialog. */
  onRequestCommit: () => void;
  /** The parent's working state isn't clean — go deal with it there. */
  onSwitchToParent: (parentBranchId: number) => void;
  onLanded: (landing: MergeLanding) => void;
  /** Where onClose lands — the repo home opens this view too. */
  backLabel?: string | null;
}) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [oursRenames, setOursRenames] = useState<RenameDecision[]>([]);
  const [theirsRenames, setTheirsRenames] = useState<RenameDecision[]>([]);
  const [picks, setPicks] = useState<Record<string, MergeSide>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ phase: "loading" });
    setOursRenames([]);
    setTheirsRenames([]);
    setPicks({});
    setApplyError(null);
    api
      .getMergeContext(sourceBranchId)
      .then((context) => {
        if (!cancelled) setLoad({ phase: "ready", context });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoad({
            phase: "error",
            message:
              e instanceof ApiError ? e.message : "Couldn't load what this merge needs",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceBranchId, reloadTick]);

  const context = load.phase === "ready" ? load.context : null;

  // Git-strict preconditions (#20): "clean" means the saved working
  // state matches the tip — compared with the diff engine, so a pure
  // reorder still counts as clean (decisions.md #18).
  const sourceDirty = useMemo(
    () =>
      context !== null &&
      diffSchemas(context.source.tip.snapshot, context.source.working.snapshot)
        .changes.length > 0,
    [context],
  );
  const parentDirty = useMemo(
    () =>
      context !== null &&
      diffSchemas(context.parent.tip.snapshot, context.parent.working.snapshot)
        .changes.length > 0,
    [context],
  );

  const result = useMemo(() => {
    if (!context) return null;
    return mergeSchemas(
      context.base,
      context.parent.tip.snapshot,
      context.source.tip.snapshot,
      {
        oursRenames,
        theirsRenames,
        resolutions: Object.entries(picks).map(([id, choose]) => ({ id, choose })),
      },
    );
  }, [context, oursRenames, theirsRenames, picks]);

  const grids = useMemo(() => {
    if (!context || !result) return null;
    const ours = buildDiffCards(context.base, context.parent.tip.snapshot, {
      changes: result.oursChanges,
      questions: [],
    });
    const theirs = buildDiffCards(context.base, context.source.tip.snapshot, {
      changes: result.theirsChanges,
      questions: [],
    });
    const theirsUntouched = new Set(theirs.unchanged);
    const untouchedBoth = ours.unchanged.filter((name) => theirsUntouched.has(name));
    const timeline = buildMergeTimeline(ours.cards, theirs.cards, result.conflicts);
    return { ours, theirs, untouchedBoth, timeline };
  }, [context, result]);

  function reload() {
    setReloadTick((tick) => tick + 1);
  }

  function answerQuestion(mergeQuestion: MergeQuestion, rename: boolean) {
    const q = mergeQuestion.question;
    const decision: RenameDecision =
      q.kind === "table"
        ? { kind: "table", from: q.from, to: q.to, rename }
        : { kind: "column", table: q.table, from: q.from, to: q.to, rename };
    if (mergeQuestion.side === "ours") {
      setOursRenames((list) => [...list, decision]);
    } else {
      setTheirsRenames((list) => [...list, decision]);
    }
  }

  async function apply() {
    if (!context || !result?.merged) return;
    setApplying(true);
    setApplyError(null);
    try {
      const outcome = await api.saveWorking(
        context.parent.branch.id,
        result.merged,
        context.parent.working.rev,
      );
      if (outcome.ok) {
        onLanded({
          parentBranchId: context.parent.branch.id,
          parentBranchName: context.parent.branch.name,
          sourceBranchId: context.source.branch.id,
          sourceBranchName: context.source.branch.name,
          mergedCommitId: context.source.tip.commit.id,
          restoreSnapshot: context.parent.tip.snapshot,
        });
      } else {
        setApplyError(
          `${outcome.conflict.savedBy ?? "Someone"} saved on “${context.parent.branch.name}” while you were merging — reload the merge to work from their state.`,
        );
      }
    } catch (e) {
      setApplyError(
        e instanceof ApiError ? e.message : "Couldn't apply the merge — try again",
      );
    } finally {
      setApplying(false);
    }
  }

  const sourceName = context?.source.branch.name ?? "";
  const parentName = context?.parent.branch.name ?? "";
  const sideName = (side: MergeSide) => (side === "ours" ? parentName : sourceName);

  let body;
  if (load.phase === "loading") {
    body = (
      <div className="empty empty--main">
        <p>Loading both branches…</p>
      </div>
    );
  } else if (load.phase === "error") {
    body = (
      <div className="empty empty--main">
        <h2>Can't start this merge</h2>
        <p>{load.message}</p>
        <button type="button" className="btn" onClick={reload}>
          Try again
        </button>
      </div>
    );
  } else if (sourceDirty) {
    body = (
      <div className="empty empty--main">
        <h2>Commit this branch's work first</h2>
        <p>
          “{sourceName}” has saved changes that aren't committed yet. A merge
          takes the branch's <strong>last commit</strong> — commit first so
          nothing gets left behind, then start the merge again.
        </p>
        <button type="button" className="btn btn--primary" onClick={onRequestCommit}>
          Commit these changes…
        </button>
      </div>
    );
  } else if (parentDirty) {
    body = (
      <div className="empty empty--main">
        <h2>“{parentName}” has uncommitted work</h2>
        <p>
          The merge lands in “{parentName}”'s working state and would overwrite
          what's saved there
          {context?.parent.working.savedBy
            ? ` (last saved by ${context.parent.working.savedBy})`
            : ""}
          . Switch to “{parentName}” and commit or discard that work first.
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => context && onSwitchToParent(context.parent.branch.id)}
        >
          Go to “{parentName}”
        </button>
      </div>
    );
  } else if (result && result.theirsChanges.length === 0) {
    body = (
      <div className="empty empty--main">
        <h2>Nothing to merge</h2>
        <p>
          “{sourceName}”'s last commit adds nothing beyond “{parentName}” —
          there's nothing to bring over.
        </p>
      </div>
    );
  } else if (context && result && grids) {
    const unresolved = result.conflicts.filter((c) => !picks[c.id]).length;
    const status =
      result.questions.length > 0
        ? `${result.questions.length} rename question${result.questions.length === 1 ? "" : "s"} to answer first`
        : unresolved > 0
          ? `${unresolved} of ${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} still need${unresolved === 1 ? "s" : ""} a side`
          : result.conflicts.length > 0
            ? "All conflicts resolved — ready to apply"
            : "No conflicts — ready to apply";
    body = (
      <>
        <RenameQuestionsBanner
          title="Rename questions — answer these first"
          hint="Each side's changes since the branch point are read separately. Until you answer, a pair counts as dropped + added, and the conflicts below are provisional."
          items={result.questions.map((q) => ({
            key: `${q.side}:${q.question.kind}:${q.question.from}:${q.question.to}`,
            text: (
              <>
                On “{sideName(q.side)}”: {describeRenameQuestion(q.question)}
              </>
            ),
            answer: (rename: boolean) => answerQuestion(q, rename),
          }))}
        />
        {result.conflicts.length > 0 && (
          <section className="merge-conflicts">
            <h3>
              <span className="merge-conflicts-mark" aria-hidden="true">
                !
              </span>
              {result.conflicts.length} conflict
              {result.conflicts.length === 1 ? "" : "s"} — pick a side for each
            </h3>
            <p className="merge-conflicts-hint">
              Both branches changed the same thing. Keeping a side keeps that
              side's whole group and drops the other's, so any combination of
              picks stays a valid schema. Changes here are named as of the
              branch point.
            </p>
            {result.conflicts.map((conflict) => (
              <ConflictRow
                key={conflict.id}
                conflict={conflict}
                pick={picks[conflict.id]}
                oursName={parentName}
                theirsName={sourceName}
                onPick={(side) =>
                  setPicks((current) => ({ ...current, [conflict.id]: side }))
                }
              />
            ))}
          </section>
        )}
        {/* One spine from the branch point down, both sides hung off
            it. A table both branches touched shares a rung, so the
            disagreement reads across one line, not down two columns. */}
        <section className="merge-tl">
          <span className="merge-tl-origin">Branch point</span>
          <div className="merge-tl-heads">
            <h3 className="merge-tl-head merge-tl-head--ours">
              <span className="merge-tl-head-dot" aria-hidden="true" />
              Changes on “{parentName}” since the branch point
            </h3>
            <h3 className="merge-tl-head merge-tl-head--theirs">
              <span className="merge-tl-head-dot" aria-hidden="true" />
              Changes on “{sourceName}” since the branch point
            </h3>
          </div>
          <ol className="merge-tl-rows">
            {grids.timeline.map((row, i) => {
              // A rung is only alarming while its conflict is open: once
              // a side is picked it keeps the badge but drops the red,
              // the same way the conflict row above it does.
              const open = row.conflictIds.some((id) => !picks[id]);
              const conflicted = row.conflictIds.length > 0;
              const badge = conflicted ? (
                <span className="diff-badge diff-badge--conflict">conflict</span>
              ) : undefined;
              return (
                <li
                  key={row.name}
                  className={[
                    "merge-tl-row",
                    open ? "merge-tl-row--conflict" : "",
                    conflicted && !open ? "merge-tl-row--settled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  // How far down the spine this rung sits, 0–1, so its
                  // node can take the spine's colour where they meet.
                  style={
                    {
                      "--tl-t":
                        grids.timeline.length < 2
                          ? 0
                          : i / (grids.timeline.length - 1),
                    } as CSSProperties
                  }
                >
                  <div className="merge-tl-cell merge-tl-cell--ours">
                    {row.ours && (
                      <>
                        <span className="merge-tl-cell-side">{parentName}</span>
                        <DiffCard card={row.ours} badge={badge} />
                      </>
                    )}
                  </div>
                  <span className="merge-tl-node" aria-hidden="true" />
                  <div className="merge-tl-cell merge-tl-cell--theirs">
                    {row.theirs && (
                      <>
                        <span className="merge-tl-cell-side">{sourceName}</span>
                        <DiffCard card={row.theirs} badge={badge} />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {grids.timeline.length === 0 && (
            <p className="diff-card-note merge-tl-empty">
              Neither side has moved since the branch point.
            </p>
          )}
          {grids.ours.cards.length === 0 && grids.timeline.length > 0 && (
            <p className="diff-card-note merge-tl-quiet merge-tl-quiet--ours">
              No changes — “{parentName}” hasn't moved since “{sourceName}”
              split off.
            </p>
          )}
          {grids.theirs.cards.length === 0 && grids.timeline.length > 0 && (
            <p className="diff-card-note merge-tl-quiet merge-tl-quiet--theirs">
              No changes on “{sourceName}”.
            </p>
          )}
        </section>
        {grids.untouchedBoth.length > 0 && (
          <p className="diff-unchanged">
            Untouched by both sides: {grids.untouchedBoth.join(", ")}
          </p>
        )}
        {applyError && (
          <p className="field-error merge-apply-error" role="alert">
            {applyError}{" "}
            <button type="button" className="btn" onClick={reload}>
              Reload merge
            </button>
          </p>
        )}
        <div className="merge-apply">
          <div className="merge-apply-text">
            <span
              className={
                result.merged === null
                  ? "merge-apply-status merge-apply-status--blocked"
                  : "merge-apply-status"
              }
            >
              {status}
            </span>
            <span className="merge-apply-hint">
              Applying saves the merged schema as “{parentName}”'s working
              state — nothing is committed until you commit it there.
            </span>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={result.merged === null || applying}
            onClick={() => void apply()}
          >
            {applying ? "Applying…" : `Apply merge into “${parentName}”`}
          </button>
        </div>
      </>
    );
  }

  return (
    <main className="diff-view">
      <div className="diff-head">
        {/* Only when closing lands somewhere the top bar can't take
            you: the editor or the entry doors. Getting to the repo
            home is the top bar's job alone. */}
        {backLabel !== null && (
          <button type="button" className="btn" onClick={onClose}>
            ← {backLabel}
          </button>
        )}
        <div className="diff-title">
          <h2>
            {context ? (
              <>
                Merge “
                <span className="diff-title-branch diff-title-branch--source">
                  {sourceName}
                </span>
                ” into “
                <span className="diff-title-branch">{parentName}</span>”
              </>
            ) : (
              "Merge into parent"
            )}
          </h2>
          {context && (
            <p>
              Brings “{sourceName}”'s commit “{context.source.tip.commit.message}
              ” into “{parentName}” — both sides read against the branch point.
            </p>
          )}
        </div>
      </div>
      {body}
    </main>
  );
}

/** One conflict, one row: what disagrees, then the two ways out. The
 *  per-side change lists live on the timeline below instead, on the
 *  cards of the tables the conflict touches. */
function ConflictRow({
  conflict,
  pick,
  oursName,
  theirsName,
  onPick,
}: {
  conflict: MergeConflict;
  pick: MergeSide | undefined;
  oursName: string;
  theirsName: string;
  onPick: (side: MergeSide) => void;
}) {
  return (
    <section
      className={pick ? "merge-conflict merge-conflict--resolved" : "merge-conflict"}
    >
      <ul className="merge-reasons">
        {conflict.reasons.map((reason) => (
          <li key={reason}>
            <span>{quotedInMono(reason)}</span>
          </li>
        ))}
      </ul>
      <div className="merge-picks">
        <PickButton
          tone="ours"
          label={oursName}
          state={pick === undefined ? "open" : pick === "ours" ? "kept" : "dropped"}
          onPick={() => onPick("ours")}
        />
        <PickButton
          tone="theirs"
          label={theirsName}
          state={pick === undefined ? "open" : pick === "theirs" ? "kept" : "dropped"}
          onPick={() => onPick("theirs")}
        />
      </div>
    </section>
  );
}

/** Every quoted run in an engine sentence is an identifier — render
 *  those in mono so the thing in dispute is findable at a glance. The
 *  sentence itself is the engine's, unchanged. */
function quotedInMono(text: string) {
  return text.split(/"([^"]*)"/).map((part, i) =>
    i % 2 === 1 ? <code key={i}>&quot;{part}&quot;</code> : <span key={i}>{part}</span>,
  );
}

function PickButton({
  tone,
  label,
  state,
  onPick,
}: {
  /** Which branch this side is: violet for the one merged into,
   *  magenta for the one being merged. */
  tone: "ours" | "theirs";
  label: string;
  state: "open" | "kept" | "dropped";
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn merge-pick merge-pick--${tone} merge-pick--${state}`}
      aria-pressed={state === "kept"}
      onClick={onPick}
    >
      Keep “{label}”'s version
    </button>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  diffSchemas,
  type RenameDecision,
  type RenameQuestion,
  type Schema,
} from "engine";
import { api, ApiError, type CommitMeta } from "../api.ts";
import { timeAgo } from "../time.ts";
import { buildDiffCards } from "../diff/view-model.ts";
import { DiffCardGrid } from "./DiffCardGrid.tsx";

// The diff screen (decisions.md #19): what one commit changed, or what
// the schema on screen changed since the last commit. The diff runs
// client-side (the engine is already in the bundle), so answering a
// rename question re-renders instantly. Answers are ephemeral — they
// shape this view and die with it; the day-3 merge collects its own.

export type DiffTarget =
  | { kind: "commit"; commit: CommitMeta }
  | { kind: "working" };

/** Key a DiffView by this so switching targets resets its answers. */
export function diffTargetKey(target: DiffTarget): string {
  return target.kind === "commit" ? `commit:${target.commit.id}` : "working";
}

const EMPTY: Schema = { tables: [] };

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  /** `to` is null in working mode: the live on-screen schema is used. */
  | { phase: "ready"; from: Schema; to: Schema | null };

export function DiffView({
  target,
  commits,
  workingSchema,
  branchName,
  parentName,
  onClose,
}: {
  target: DiffTarget;
  /** The branch's commits, newest first. */
  commits: CommitMeta[];
  /** The schema on screen right now — the `to` side of a working review. */
  workingSchema: Schema;
  branchName: string;
  /** Parent branch name, when this branch split from one. */
  parentName: string | null;
  onClose: () => void;
}) {
  const index =
    target.kind === "commit"
      ? commits.findIndex((c) => c.id === target.commit.id)
      : -1;
  const predecessor = index >= 0 ? commits[index + 1] : undefined;

  // The oldest commit of a branch with a parent is the copied
  // split-point commit (decisions.md #16): nothing was authored here,
  // so it renders as a branch-point marker, not a diff.
  const isBranchPoint =
    target.kind === "commit" &&
    parentName !== null &&
    index === commits.length - 1;

  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [decisions, setDecisions] = useState<RenameDecision[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });

    async function load(): Promise<LoadState | null> {
      if (target.kind === "working") {
        const latest = commits[0];
        if (!latest) {
          return { phase: "error", message: "No commits to compare against yet." };
        }
        const { snapshot } = await api.getCommit(latest.id);
        return { phase: "ready", from: snapshot, to: null };
      }
      const idx = commits.findIndex((c) => c.id === target.commit.id);
      if (idx === -1) {
        return { phase: "error", message: "This commit isn't in the loaded history." };
      }
      if (parentName !== null && idx === commits.length - 1) {
        return null; // branch-point marker — nothing to fetch or diff
      }
      const before = commits[idx + 1];
      const [to, from] = await Promise.all([
        api.getCommit(target.commit.id),
        // Main's first commit has no predecessor: it grew from nothing.
        before ? api.getCommit(before.id) : null,
      ]);
      return {
        phase: "ready",
        from: from ? from.snapshot : EMPTY,
        to: to.snapshot,
      };
    }

    load()
      .then((next) => {
        if (!cancelled && next) setState(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            phase: "error",
            message:
              e instanceof ApiError ? e.message : "Couldn't load these versions",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target, commits, parentName]);

  const from = state.phase === "ready" ? state.from : null;
  const to = state.phase === "ready" ? (state.to ?? workingSchema) : null;

  const diff = useMemo(
    () => (from && to ? diffSchemas(from, to, decisions) : null),
    [from, to, decisions],
  );
  const cards = useMemo(
    () => (from && to && diff ? buildDiffCards(from, to, diff) : null),
    [from, to, diff],
  );

  function answer(question: RenameQuestion, rename: boolean) {
    const decision: RenameDecision =
      question.kind === "table"
        ? { kind: "table", from: question.from, to: question.to, rename }
        : {
            kind: "column",
            table: question.table,
            from: question.from,
            to: question.to,
            rename,
          };
    setDecisions((list) => [...list, decision]);
  }

  const title =
    target.kind === "commit"
      ? isBranchPoint
        ? "Branch point"
        : `“${target.commit.message}”`
      : "Changes since last commit";
  const subtitle =
    target.kind === "commit"
      ? isBranchPoint
        ? `Where “${branchName}” split from “${parentName}”`
        : `${target.commit.author} · ${timeAgo(target.commit.createdAt)} · compared with ${
            predecessor ? `“${predecessor.message}”` : "an empty schema"
          }`
      : `The schema on screen vs “${commits[0]?.message ?? ""}”`;

  return (
    <main className="diff-view">
      <div className="diff-head">
        <button type="button" className="btn" onClick={onClose}>
          ← Editor
        </button>
        <div className="diff-title">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>

      {isBranchPoint ? (
        <div className="empty empty--main">
          <h2>Nothing was authored here</h2>
          <p>
            This commit marks where <strong>{branchName}</strong> split from{" "}
            <strong>{parentName}</strong> — the schema was inherited as-is.
            See “{parentName}” for the history behind it.
          </p>
        </div>
      ) : state.phase === "loading" ? (
        <div className="empty empty--main">
          <p>Loading versions…</p>
        </div>
      ) : state.phase === "error" ? (
        <div className="empty empty--main">
          <h2>Can't show this diff</h2>
          <p>{state.message}</p>
        </div>
      ) : (
        diff &&
        cards && (
          <>
            {diff.questions.length > 0 && (
              <div className="diff-questions">
                <h3>
                  Possible {diff.questions.length === 1 ? "rename" : "renames"} —
                  you decide
                </h3>
                <p className="diff-questions-hint">
                  A snapshot can't tell a rename from a drop + add. Until you
                  answer, the pair below shows as dropped and added. Answers
                  only shape this view — nothing is saved.
                </p>
                <ul>
                  {diff.questions.map((question) => (
                    <li key={`${question.kind}:${question.from}:${question.to}`}>
                      <span className="diff-question-text">
                        {question.kind === "table" ? (
                          <>
                            Was table <code>{question.from}</code> renamed to{" "}
                            <code>{question.to}</code>?
                          </>
                        ) : (
                          <>
                            In <code>{question.table}</code>: was{" "}
                            <code>{question.from}</code> renamed to{" "}
                            <code>{question.to}</code>?
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => answer(question, true)}
                      >
                        Yes, renamed
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => answer(question, false)}
                      >
                        No
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diff.changes.length === 0 && diff.questions.length === 0 ? (
              <div className="empty empty--main">
                <h2>No schema changes</h2>
                <p>
                  {target.kind === "working"
                    ? "The schema on screen matches the last commit — nothing new to commit."
                    : "This commit recorded the same schema as its predecessor."}
                </p>
              </div>
            ) : (
              <DiffCardGrid cards={cards.cards} unchanged={cards.unchanged} />
            )}
          </>
        )
      )}
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { EXAMPLE_SCHEMA, findTable, type Schema } from "engine";
import {
  api,
  ApiError,
  type Branch,
  type CommitMeta,
  type Repo,
  type SaveConflict,
} from "../api.ts";
import { session } from "../session.ts";
import { BranchBar } from "./BranchBar.tsx";
import { CompareView } from "./CompareView.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DiffView, diffTargetKey, type DiffTarget } from "./DiffView.tsx";
import { FirstCommitGate } from "./FirstCommitGate.tsx";
import { HistoryPanel } from "./HistoryPanel.tsx";
import { MergeView, type MergeLanding } from "./MergeView.tsx";
import { ImportExportDialog } from "./ImportExportDialog.tsx";
import { SqlImportDialog } from "./SqlImportDialog.tsx";
import { MembersDialog } from "./MembersDialog.tsx";
import { OverwriteDialog } from "./OverwriteDialog.tsx";
import { TableEditor, type EditRequest } from "./TableEditor.tsx";
import { TableList } from "./TableList.tsx";
import { TextPromptDialog } from "./TextPromptDialog.tsx";
import { Toast, type ToastData } from "./Toast.tsx";
import { UnsavedDialog } from "./UnsavedDialog.tsx";
import { renameTable } from "../schema/edits.ts";

// One repo, opened: branch bar on top, the editor in the middle,
// history on the side. This component owns the save model of
// decisions.md #15 — dirty is "the schema on screen isn't the object
// we last saved", saves happen only when the user acts, and every
// destructive path goes through a dialog.

const UNDO_LIMIT = 50;

interface HistoryState {
  past: Schema[];
  present: Schema;
}

interface WorkingInfo {
  rev: number;
  savedBy: string | null;
  savedAt: string | null;
}

/** A stale save plus what to do if the user picks "overwrite". */
interface ConflictState {
  conflict: SaveConflict;
  retry: (freshRev: number) => void;
}

interface UnsavedState {
  actionLabel: string;
  /** What to do once the unsaved edits are saved or discarded. */
  go: () => void;
}

export function RepoScreen({
  username,
  repoId,
  onLeaveRepo,
}: {
  username: string;
  repoId: number;
  onLeaveRepo: () => void;
}) {
  // --- repo-level state -------------------------------------------------
  const [repo, setRepo] = useState<Repo | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<number | null>(null);

  // --- branch-level state (reset by loadBranch) --------------------------
  const [history, setHistory] = useState<HistoryState | null>(null);
  const [savedSchema, setSavedSchema] = useState<Schema | null>(null);
  const [working, setWorking] = useState<WorkingInfo>({
    rev: 0,
    savedBy: null,
    savedAt: null,
  });
  const [commits, setCommits] = useState<CommitMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gateDismissed, setGateDismissed] = useState<Set<number>>(new Set());

  // --- dialogs & panels ---------------------------------------------------
  const [confirm, setConfirm] = useState<EditRequest | null>(null);
  const [io, setIo] = useState<"import" | "export" | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [unsaved, setUnsaved] = useState<UnsavedState | null>(null);
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [branching, setBranching] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchFromId, setBranchFromId] = useState<number | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [merging, setMerging] = useState(false);
  const [comparing, setComparing] = useState(false);
  // A landed-but-uncommitted merge (decisions.md #20): remembered so
  // the commit can carry the merge marker. In memory only — a reload
  // loses it (#20's accepted corner). Keyed to its parent branch, so
  // switching branches and coming back keeps it usable.
  const [pendingMerge, setPendingMerge] = useState<MergeLanding | null>(null);
  const [commitPrefill, setCommitPrefill] = useState<string | null>(null);

  const schema = history?.present ?? null;
  const dirty = history !== null && history.present !== savedSchema;

  // A branch splits at a commit (decisions.md #16), so only branches
  // with one are valid sources; commitCount is kept fresh by doCommit.
  const branchable = branches.filter((b) => b.commitCount > 0);

  // --- loading --------------------------------------------------------------

  // Every branch load takes a ticket; anything async (an older load, an
  // in-flight save) only applies its result if the ticket is still
  // current. Without this, a slow response could put branch A's schema
  // on screen labeled as branch B — and a Save would then corrupt B.
  const loadSeqRef = useRef(0);

  const loadBranch = useCallback(async (id: number) => {
    const seq = ++loadSeqRef.current;
    setBranchId(id);
    session.setBranchId(id);
    setHistory(null);
    setConflictState(null);
    setDiffTarget(null);
    setMerging(false);
    setComparing(false);
    try {
      const [state, commitList] = await Promise.all([
        api.getBranch(id),
        api.listCommits(id),
      ]);
      if (seq !== loadSeqRef.current) return; // superseded by a newer switch
      setHistory({ past: [], present: state.snapshot });
      setSavedSchema(state.snapshot);
      setWorking({ rev: state.rev, savedBy: state.savedBy, savedAt: state.savedAt });
      setSelected(state.snapshot.tables[0]?.name ?? null);
      setCommits(commitList);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load this branch");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getRepo(repoId)
      .then(({ repo, branches }) => {
        if (cancelled) return;
        setRepo(repo);
        setBranches(branches);
        const remembered = session.getBranchId();
        const startAt =
          branches.find((b) => b.id === remembered) ??
          branches.find((b) => b.name === "main") ??
          branches[0];
        if (startAt) void loadBranch(startAt.id);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof ApiError ? e.message : "Couldn't load this repo");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, loadBranch]);

  // The native prompt on tab close/refresh — the only dialog browsers
  // allow there (decisions.md #15). In-app navigations get UnsavedDialog.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // --- editing (same undo model the editor shipped with) --------------------

  const applyEdit = useCallback((next: Schema, toastMessage?: string) => {
    setHistory((h) => {
      if (!h) return h;
      return { past: [...h.past.slice(-(UNDO_LIMIT - 1)), h.present], present: next };
    });
    if (toastMessage) {
      setToast({ id: Date.now(), message: toastMessage, undoable: true });
    }
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h) return h;
      const previous = h.past[h.past.length - 1];
      if (previous === undefined) return h;
      return { past: h.past.slice(0, -1), present: previous };
    });
    setToast(null);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") {
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      ) {
        return; // let the browser undo typing in the field
      }
      // While any modal is up, the schema on screen must stay frozen —
      // an undo behind a conflict dialog would make "Overwrite their
      // save" send something the user no longer sees.
      if (document.querySelector(".overlay")) return;
      e.preventDefault();
      undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // Deleting or importing can invalidate the selection.
  const selectedTable = schema && selected ? findTable(schema, selected) : undefined;
  useEffect(() => {
    if (!schema) return;
    if (selected && !findTable(schema, selected)) {
      setSelected(schema.tables[0]?.name ?? null);
    } else if (!selected) {
      setSelected(schema.tables[0]?.name ?? null);
    }
  }, [schema, selected]);

  function requestEdit(request: EditRequest) {
    if (!schema || request.result.schema === schema) return; // guarded no-op
    if (request.result.collateral.length > 0) {
      setConfirm(request);
    } else {
      applyEdit(request.result.schema, request.toast);
    }
  }

  function confirmEdit(request: EditRequest) {
    const n = request.result.collateral.length;
    applyEdit(
      request.result.schema,
      `${request.toast ?? "Change applied"} — also removed ${n} dependent ${
        n === 1 ? "item" : "items"
      }`,
    );
    setConfirm(null);
  }

  // --- save / commit (decisions.md #15) --------------------------------------

  const doSave = useCallback(
    async (expectedRev: number, andThen?: () => void) => {
      if (!history || branchId === null) return;
      const seq = loadSeqRef.current;
      const snapshot = history.present;
      setSaving(true);
      try {
        const outcome = await api.saveWorking(branchId, snapshot, expectedRev);
        if (seq !== loadSeqRef.current) return; // we've left that branch — don't touch the new one's state
        if (outcome.ok) {
          setSavedSchema(snapshot);
          setWorking({ rev: outcome.rev, savedBy: username, savedAt: outcome.savedAt });
          setToast({ id: Date.now(), message: "Saved", undoable: false });
          andThen?.();
        } else {
          setConflictState({
            conflict: outcome.conflict,
            retry: (freshRev) => void doSave(freshRev, andThen),
          });
        }
      } catch (e) {
        setToast({
          id: Date.now(),
          message: e instanceof ApiError ? e.message : "Save failed — try again",
          undoable: false,
        });
      } finally {
        setSaving(false);
      }
    },
    [history, branchId, username],
  );

  const doCommit = useCallback(
    async (message: string, expectedRev: number) => {
      if (!history || branchId === null) return;
      const seq = loadSeqRef.current;
      const snapshot = history.present;
      // A commit on a branch holding a landed merge IS the merge
      // commit — it carries the marker so the server advances the
      // merged branch's base in the same transaction (decisions.md #20).
      const marker =
        pendingMerge && pendingMerge.parentBranchId === branchId
          ? {
              sourceBranchId: pendingMerge.sourceBranchId,
              mergedCommitId: pendingMerge.mergedCommitId,
            }
          : undefined;
      setSaving(true);
      try {
        const outcome = await api.commit(branchId, message, snapshot, expectedRev, marker);
        if (seq !== loadSeqRef.current) return; // we've left that branch — don't touch the new one's state
        if (outcome.ok) {
          setCommitting(false);
          setSavedSchema(snapshot);
          setWorking({ rev: outcome.rev, savedBy: username, savedAt: outcome.savedAt });
          setCommits((list) => [outcome.commit, ...list]);
          setBranches((list) =>
            list.map((b) =>
              b.id === branchId ? { ...b, commitCount: b.commitCount + 1 } : b,
            ),
          );
          if (marker) setPendingMerge(null);
          setToast({
            id: Date.now(),
            message: marker
              ? `Committed “${message}” — merge recorded, “${pendingMerge?.sourceBranchName}” can keep going from here`
              : `Committed “${message}”`,
            undoable: false,
          });
        } else {
          setCommitting(false);
          setConflictState({
            conflict: outcome.conflict,
            retry: (freshRev) => void doCommit(message, freshRev),
          });
        }
      } catch (e) {
        setCommitError(e instanceof ApiError ? e.message : "Commit failed — try again");
      } finally {
        setSaving(false);
      }
    },
    [history, branchId, username, pendingMerge],
  );

  // --- navigation guards -------------------------------------------------------

  function guardDirty(actionLabel: string, go: () => void) {
    if (!dirty) {
      go();
      return;
    }
    setUnsaved({ actionLabel, go });
  }

  function requestSwitch(nextId: number) {
    if (nextId === branchId) return;
    const target = branches.find((b) => b.id === nextId);
    guardDirty(`switch to “${target?.name ?? "that branch"}”`, () => {
      void loadBranch(nextId);
    });
  }

  // --- branching ------------------------------------------------------------

  async function reallyCreateBranch(name: string, fromId: number) {
    try {
      const branch = await api.createBranch(repoId, name, fromId);
      setBranches((list) => [...list, branch]);
      void loadBranch(branch.id);
      setToast({
        id: Date.now(),
        message: `Branched “${branch.name}” — you're on it now`,
        undoable: false,
      });
    } catch (e) {
      // The dialog is already closed (one modal at a time), so server
      // rejections land as a toast; duplicate names are caught before
      // submit, making this a rare race.
      setToast({
        id: Date.now(),
        message: e instanceof ApiError ? e.message : "Couldn't create the branch",
        undoable: false,
      });
    }
  }

  // The branch dialog closes before any unsaved dialog can appear, so
  // no modal ever renders buried under another.
  function createBranch(name: string) {
    const fromId = branchFromId ?? branchId;
    if (fromId === null) return;
    setBranching(false);
    if (dirty) {
      // Decisions.md #15: creating a branch navigates away from the
      // current working state, so unsaved edits get the same three-way
      // choice as a branch switch — whatever the source branch is.
      // "Save & continue" also means branching from the current branch
      // starts from exactly what's on screen.
      setUnsaved({
        actionLabel: `create “${name}”`,
        go: () => void reallyCreateBranch(name, fromId),
      });
    } else {
      void reallyCreateBranch(name, fromId);
    }
  }

  // --- conflict resolution ----------------------------------------------------

  async function loadTheirs() {
    if (branchId === null) return;
    try {
      const state = await api.getBranch(branchId);
      setHistory((h) =>
        h
          ? { past: [...h.past.slice(-(UNDO_LIMIT - 1)), h.present], present: state.snapshot }
          : { past: [], present: state.snapshot },
      );
      setSavedSchema(state.snapshot);
      setWorking({ rev: state.rev, savedBy: state.savedBy, savedAt: state.savedAt });
      setConflictState(null);
      setToast({
        id: Date.now(),
        message: "Loaded their version — Undo brings yours back",
        undoable: true,
      });
    } catch (e) {
      setToast({
        id: Date.now(),
        message: e instanceof ApiError ? e.message : "Couldn't load their version",
        undoable: false,
      });
    }
  }

  // --- merge (decisions.md #20) ---------------------------------------------

  function toggleMerge() {
    if (merging) {
      setMerging(false);
      return;
    }
    // Unsaved on-screen edits go through the usual three-way dialog
    // first; the merge view then checks the deeper git-strict
    // preconditions (saved-but-uncommitted work) itself.
    guardDirty("start the merge", () => {
      setComparing(false);
      setDiffTarget(null);
      setMerging(true);
    });
  }

  function toggleCompare() {
    if (comparing) {
      setComparing(false);
      return;
    }
    setMerging(false);
    setDiffTarget(null);
    setComparing(true);
  }

  /** The merged schema was saved into the parent's working state —
   *  move there and remember the marker for the eventual commit. */
  function landMerge(landing: MergeLanding) {
    setPendingMerge(landing);
    setMerging(false);
    void loadBranch(landing.parentBranchId);
    setToast({
      id: Date.now(),
      message: `Merged “${landing.sourceBranchName}” into “${landing.parentBranchName}” — review it here, then commit to make it history`,
      undoable: false,
    });
  }

  /** Put the parent's last-committed schema back on screen (an
   *  ordinary undoable edit — saving it is still the user's explicit
   *  call, decisions.md #15) and forget the merge bookkeeping. */
  function abandonMerge() {
    if (!pendingMerge) return;
    setDiffTarget(null);
    applyEdit(
      pendingMerge.restoreSnapshot,
      "Merge abandoned — the schema on screen is back to the last commit (not saved yet)",
    );
    setPendingMerge(null);
  }

  function openCommitDialog(prefill: string | null) {
    setCommitPrefill(prefill);
    setCommitError(null);
    setCommitting(true);
  }

  // --- render -------------------------------------------------------------------

  if (loadError) {
    return (
      <div className="repo-error">
        <div className="empty empty--main">
          <h2>Can't open this repo</h2>
          <p>{loadError}</p>
          <button type="button" className="btn btn--primary" onClick={onLeaveRepo}>
            Back to your repos
          </button>
        </div>
      </div>
    );
  }

  const currentBranch = branches.find((b) => b.id === branchId) ?? null;
  const parentName =
    currentBranch?.parentBranchId != null
      ? (branches.find((b) => b.id === currentBranch.parentBranchId)?.name ?? null)
      : null;
  // Oldest commit of a branch with a parent = the copied split-point
  // commit (decisions.md #16), shown as a branch-point marker.
  const branchPointId =
    parentName !== null && commits.length > 0
      ? commits[commits.length - 1]!.id
      : null;

  function toggleCommitDiff(commit: CommitMeta) {
    setDiffTarget((current) =>
      current?.kind === "commit" && current.commit.id === commit.id
        ? null
        : { kind: "commit", commit },
    );
  }

  const showGate =
    schema !== null &&
    currentBranch !== null &&
    commits.length === 0 &&
    schema.tables.length === 0 &&
    !dirty &&
    !gateDismissed.has(currentBranch.id);

  return (
    <div className="repo-screen">
      <header className="topbar">
        <button
          type="button"
          className="btn"
          onClick={() => guardDirty("go back to your repos", onLeaveRepo)}
        >
          ← Repos
        </button>
        <h1>{repo?.name ?? "…"}</h1>
        {repo && (
          <button type="button" className="btn" onClick={() => setMembersOpen(true)}>
            Share{repo.members.length > 0 ? ` (${repo.members.length + 1})` : ""}
          </button>
        )}
        <div className="topbar-actions">
          <button
            type="button"
            className="btn"
            onClick={undo}
            disabled={!history || history.past.length === 0}
            title="Undo last edit (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setIo("import")}
            disabled={!schema}
          >
            Import JSON
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setSqlOpen(true)}
            disabled={!schema}
            title="Postgres SQL — more dialects later"
          >
            Import SQL <span className="badge-tag">Postgres</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setIo("export")}
            disabled={!schema}
          >
            Export JSON
          </button>
          <span className="user-chip" title="Your demo identity">
            {username}
          </span>
        </div>
      </header>

      {branchId !== null && currentBranch && (
        <BranchBar
          branches={branches}
          currentId={branchId}
          dirty={dirty}
          savedBy={working.savedBy}
          savedAt={working.savedAt}
          saving={saving}
          commitCount={commits.length}
          historyOpen={historyOpen}
          reviewOpen={diffTarget?.kind === "working"}
          onSwitch={requestSwitch}
          canBranch={branchable.length > 0}
          parentName={parentName}
          mergeOpen={merging}
          canCompare={branchable.length > 0}
          compareOpen={comparing}
          canCommit={commits.length > 0 || (schema?.tables.length ?? 0) > 0}
          onNewBranch={() => {
            setBranchFromId(
              branchable.some((b) => b.id === branchId)
                ? branchId
                : (branchable[0]?.id ?? null),
            );
            setBranchError(null);
            setBranching(true);
          }}
          onSave={() => void doSave(working.rev)}
          onCommit={() => openCommitDialog(null)}
          onToggleHistory={() => setHistoryOpen((open) => !open)}
          onToggleReview={() =>
            setDiffTarget((current) =>
              current?.kind === "working" ? null : { kind: "working" },
            )
          }
          onToggleMerge={toggleMerge}
          onToggleCompare={toggleCompare}
        />
      )}

      {pendingMerge && branchId === pendingMerge.parentBranchId && !merging && (
        <div className="merge-banner">
          <p className="merge-banner-text">
            <strong>Merging “{pendingMerge.sourceBranchName}”</strong> — the
            merged schema is saved here as the working state. Review it, adjust
            in the editor if something's off, then commit to finish.
          </p>
          <div className="merge-banner-actions">
            <button
              type="button"
              className={diffTarget?.kind === "working" ? "btn btn--toggled" : "btn"}
              onClick={() =>
                setDiffTarget((current) =>
                  current?.kind === "working" ? null : { kind: "working" },
                )
              }
            >
              Review changes
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                openCommitDialog(`Merge branch '${pendingMerge.sourceBranchName}'`)
              }
            >
              Commit merge…
            </button>
            <button type="button" className="btn" onClick={abandonMerge}>
              Abandon
            </button>
          </div>
        </div>
      )}

      <div className="layout">
        {schema === null ? (
          <div className="empty empty--main">
            <p>Loading branch…</p>
          </div>
        ) : showGate ? (
          <FirstCommitGate
            branchName={currentBranch?.name ?? ""}
            onStartEditing={() => {
              if (currentBranch) {
                setGateDismissed((s) => new Set(s).add(currentBranch.id));
              }
            }}
            onImportJson={() => setIo("import")}
            onImportSql={() => setSqlOpen(true)}
            onLoadExample={() =>
              applyEdit(EXAMPLE_SCHEMA, "Example schema loaded — not saved yet")
            }
          />
        ) : (
          <>
            {merging && branchId !== null ? (
              <MergeView
                sourceBranchId={branchId}
                onClose={() => setMerging(false)}
                onRequestCommit={() => {
                  setMerging(false);
                  openCommitDialog(null);
                }}
                onSwitchToParent={requestSwitch}
                onLanded={landMerge}
              />
            ) : comparing && branchId !== null ? (
              <CompareView
                branches={branches}
                initialBranchId={branchId}
                onClose={() => setComparing(false)}
              />
            ) : diffTarget ? (
              <DiffView
                key={diffTargetKey(diffTarget)}
                target={diffTarget}
                commits={commits}
                workingSchema={schema}
                branchName={currentBranch?.name ?? ""}
                parentName={parentName}
                onClose={() => setDiffTarget(null)}
              />
            ) : (
              <>
                <TableList
                  schema={schema}
                  selected={selected}
                  onSelect={setSelected}
                  onApply={(next) => applyEdit(next)}
                />
                <main className="editor">
                  {selectedTable ? (
                    <TableEditor
                      schema={schema}
                      table={selectedTable}
                      onEdit={requestEdit}
                      onRenameTable={(oldName, newName) => {
                        applyEdit(renameTable(schema, oldName, newName).schema);
                        setSelected(newName);
                      }}
                    />
                  ) : (
                    <div className="empty empty--main">
                      <h2>Nothing here yet</h2>
                      <p>
                        A schema is a set of tables. Add your first one in the
                        sidebar, or use <strong>Import JSON</strong> to bring
                        one in.
                      </p>
                    </div>
                  )}
                </main>
              </>
            )}
            {historyOpen && (
              <HistoryPanel
                commits={commits}
                selectedId={
                  diffTarget?.kind === "commit" ? diffTarget.commit.id : null
                }
                branchPointId={branchPointId}
                parentName={parentName}
                onSelect={toggleCommitDiff}
              />
            )}
          </>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.confirmTitle ?? "Apply this change?"}
          lines={confirm.result.collateral}
          onCancel={() => setConfirm(null)}
          onConfirm={() => confirmEdit(confirm)}
        />
      )}
      {io && schema && (
        <ImportExportDialog
          mode={io}
          schema={schema}
          onClose={() => setIo(null)}
          onImport={(imported) => {
            applyEdit(imported, "Imported schema — not saved yet");
            setIo(null);
          }}
        />
      )}
      {sqlOpen && schema && (
        <SqlImportDialog
          onClose={() => setSqlOpen(false)}
          onImport={(imported) => {
            applyEdit(imported, "SQL imported — not saved yet");
            setSqlOpen(false);
          }}
        />
      )}
      {unsaved && (
        <UnsavedDialog
          actionLabel={unsaved.actionLabel}
          onSave={() => {
            const { go } = unsaved;
            setUnsaved(null);
            // Read dirty and rev at click time, not dialog-open time —
            // a save that landed meanwhile must not be re-sent stale.
            if (dirty) void doSave(working.rev, go);
            else go();
          }}
          onDiscard={() => {
            const { go } = unsaved;
            setUnsaved(null);
            go();
          }}
          onCancel={() => setUnsaved(null)}
        />
      )}
      {conflictState && (
        <OverwriteDialog
          conflict={conflictState.conflict}
          onOverwrite={() => {
            const { conflict, retry } = conflictState;
            setConflictState(null);
            retry(conflict.rev);
          }}
          onLoadTheirs={() => void loadTheirs()}
          onCancel={() => setConflictState(null)}
        />
      )}
      {committing && (
        <TextPromptDialog
          title="Commit this schema"
          label="What changed?"
          placeholder="e.g. add orders table with FK to users"
          submitLabel="Commit"
          initialValue={commitPrefill ?? undefined}
          hint={
            pendingMerge && branchId === pendingMerge.parentBranchId
              ? `Stamps the merged schema into history and records the merge — “${pendingMerge.sourceBranchName}” continues from what was merged.`
              : "Saves the schema and stamps it into this branch's history."
          }
          error={commitError}
          busy={saving}
          onSubmit={(message) => void doCommit(message, working.rev)}
          onCancel={() => setCommitting(false)}
        />
      )}
      {branching && (
        <TextPromptDialog
          title="New branch"
          label="Branch name"
          placeholder="e.g. add-invoices"
          submitLabel="Create branch"
          hint={
            dirty
              ? "You have unsaved changes — you'll choose to save or discard them first."
              : "Splits at the source's last commit, like git; its saved changes carry over, ready to commit."
          }
          error={branchError}
          onSubmit={(name) => {
            if (branches.some((b) => b.name === name)) {
              setBranchError(`This repo already has a branch named "${name}"`);
              return;
            }
            createBranch(name);
          }}
          onCancel={() => setBranching(false)}
        >
          <label className="prompt-label">
            Starting from
            <select
              value={branchFromId ?? undefined}
              onChange={(e) => setBranchFromId(Number(e.target.value))}
            >
              {branchable.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        </TextPromptDialog>
      )}
      {membersOpen && repo && (
        <MembersDialog
          repo={repo}
          username={username}
          onUpdated={setRepo}
          onClose={() => setMembersOpen(false)}
        />
      )}
      <Toast
        toast={toast}
        onDismiss={() => setToast(null)}
        onUndo={() => {
          undo();
          setToast(null);
        }}
      />
    </div>
  );
}

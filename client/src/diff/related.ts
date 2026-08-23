// Relatedness check for the version picker (decisions.md #21): two
// commits share an edit history only when one's branch sits on the
// other's parent chain (same branch included). Sibling branches split
// from a common parent do NOT count — each authored its changes
// independently, so a diff between them shows what differs, not what
// anyone did, and rename questions would ask about edits nobody made.
// A cheap walk over stored parent pointers, per decisions.md #7.

interface BranchLike {
  id: number;
  parentBranchId: number | null;
}

/** The branch's own id followed by every ancestor's, root last.
 *  Bounded by the branch count, so a corrupt cycle can't hang us. */
export function branchLineage(branches: BranchLike[], id: number): number[] {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const lineage: number[] = [];
  let current = byId.get(id);
  while (current && lineage.length <= branches.length) {
    lineage.push(current.id);
    current =
      current.parentBranchId === null
        ? undefined
        : byId.get(current.parentBranchId);
  }
  return lineage;
}

export function areBranchesRelated(
  branches: BranchLike[],
  a: number,
  b: number,
): boolean {
  if (a === b) return true;
  return branchLineage(branches, a).includes(b) || branchLineage(branches, b).includes(a);
}

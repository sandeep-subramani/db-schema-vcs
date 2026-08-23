import { describe, expect, it } from "vitest";
import { areBranchesRelated, branchLineage } from "./related.ts";

// The tree under test:
//   main (1)            other-root (5)
//   ├─ feature (2)
//   │  └─ nested (3)
//   └─ sibling (4)
const branches = [
  { id: 1, parentBranchId: null },
  { id: 2, parentBranchId: 1 },
  { id: 3, parentBranchId: 2 },
  { id: 4, parentBranchId: 1 },
  { id: 5, parentBranchId: null },
];

describe("branchLineage", () => {
  it("walks self → parents → root", () => {
    expect(branchLineage(branches, 3)).toEqual([3, 2, 1]);
    expect(branchLineage(branches, 1)).toEqual([1]);
  });

  it("returns empty for an unknown branch", () => {
    expect(branchLineage(branches, 99)).toEqual([]);
  });

  it("terminates on a corrupt parent cycle instead of hanging", () => {
    const cyclic = [
      { id: 1, parentBranchId: 2 },
      { id: 2, parentBranchId: 1 },
    ];
    expect(branchLineage(cyclic, 1).length).toBeLessThanOrEqual(3);
  });
});

describe("areBranchesRelated (decisions.md #21)", () => {
  it("a branch is related to itself", () => {
    expect(areBranchesRelated(branches, 2, 2)).toBe(true);
  });

  it("ancestors and descendants are related, either way around", () => {
    expect(areBranchesRelated(branches, 1, 3)).toBe(true);
    expect(areBranchesRelated(branches, 3, 1)).toBe(true);
    expect(areBranchesRelated(branches, 2, 3)).toBe(true);
  });

  it("siblings are NOT related — neither is on the other's parent chain", () => {
    expect(areBranchesRelated(branches, 2, 4)).toBe(false);
    expect(areBranchesRelated(branches, 3, 4)).toBe(false);
  });

  it("separate roots are not related", () => {
    expect(areBranchesRelated(branches, 1, 5)).toBe(false);
  });
});

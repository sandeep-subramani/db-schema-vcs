// The client's memory of where you are: username (the whole identity,
// decisions.md #13) plus the repo/branch you had open, so a refresh
// lands you back in place. localStorage only — the server never sets
// cookies or sessions.

const USERNAME_KEY = "svc.username";
const REPO_KEY = "svc.repoId";
const BRANCH_KEY = "svc.branchId";

function readInt(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export const session = {
  getUsername(): string | null {
    return localStorage.getItem(USERNAME_KEY);
  },
  setUsername(username: string): void {
    localStorage.setItem(USERNAME_KEY, username);
  },
  getRepoId(): number | null {
    return readInt(REPO_KEY);
  },
  setRepoId(repoId: number | null): void {
    if (repoId === null) {
      localStorage.removeItem(REPO_KEY);
      localStorage.removeItem(BRANCH_KEY);
    } else {
      localStorage.setItem(REPO_KEY, String(repoId));
    }
  },
  getBranchId(): number | null {
    return readInt(BRANCH_KEY);
  },
  setBranchId(branchId: number | null): void {
    if (branchId === null) localStorage.removeItem(BRANCH_KEY);
    else localStorage.setItem(BRANCH_KEY, String(branchId));
  },
  clear(): void {
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(REPO_KEY);
    localStorage.removeItem(BRANCH_KEY);
  },
};

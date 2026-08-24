import { mergeSchemas, diffSchemas } from "../../engine/src/index.ts";
const BASE = process.env.BASE ?? "https://db-schema-vcs.onrender.com/api";
const USER = process.env.USER_NAME ?? "explorer";
const get = async (p: string) => {
  const r = await fetch(BASE + p, { headers: { "x-username": USER }, signal: AbortSignal.timeout(120_000) });
  const b = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${p} ${JSON.stringify(b)}`);
  return b as any;
};

async function main() {
const { repos } = await get("/repos");
for (const repo of repos) {
  const { branches } = await get(`/repos/${repo.id}`);
  console.log(`\n=== ${repo.name} (members: ${[repo.owner, ...repo.members].join(", ")})`);
  for (const b of branches) {
    const state = await get(`/branches/${b.id}`);
    const { commits } = await get(`/branches/${b.id}/commits`);
    let dirty = "no commits";
    if (commits.length) {
      const tip = await get(`/commits/${commits[0].id}`);
      dirty = diffSchemas(tip.snapshot, state.snapshot).changes.length === 0
        ? "clean (working = tip)" : "!! DIRTY";
    }
    console.log(`  branch "${b.name}" — ${commits.length} commit(s), ${dirty}`);
    if (b.parentBranchId) {
      const ctx = await get(`/branches/${b.id}/merge-context`);
      const m = mergeSchemas(ctx.base, ctx.parent.tip.snapshot, ctx.source.tip.snapshot);
      const oursN = m.oursChanges.length, theirsN = m.theirsChanges.length;
      console.log(`     merge into "${ctx.parent.branch.name}": ${m.conflicts.length} conflict(s), `
        + `${m.questions.length} question(s), parent-side ${oursN} change(s), branch-side ${theirsN}`);
      m.conflicts.forEach(c => c.reasons.forEach(r => console.log(`       conflict: ${r}`)));
      if (!m.conflicts.length && !m.questions.length && oursN === 0 && theirsN === 0)
        console.log("       (already merged — nothing left to do)");
    }
    // rename questions inside each branch's own history
    for (let i = 0; i < commits.length - 1; i++) {
      const a = await get(`/commits/${commits[i + 1].id}`), z = await get(`/commits/${commits[i].id}`);
      const d = diffSchemas(a.snapshot, z.snapshot);
      if (d.questions.length) console.log(`     commit "${commits[i].message}" asks ${d.questions.length} rename question(s)`);
    }
  }
}

}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

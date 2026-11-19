// Compares two builds of smaltlp on the same problems, in one process, alternating them run by run, so the machine's
// drift falls on both alike: the LP benchmark problems (bench/data, through linprogSync) and the integer programs
// (bench/problems.mjs, through branch-and-bound with warm starts). Prints each one's median time for both builds, their
// ratio, and their iterations, which must be equal where a change shouldn't alter the search.
//   node bench/compare.mjs path/to/old/dist path/to/new/dist
// (Build the old one from another commit, e.g. in a git worktree: npm ci there, then point at its dist.)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeData, SIZES } from './data.mjs';
import { MIPS } from './problems.mjs';

const [oldDir, newDir] = process.argv.slice(2);
if (!oldDir || !newDir) throw new Error('usage: node bench/compare.mjs <old dist> <new dist>');
const load = async (dir) => {
  const url = pathToFileURL(resolve(dir)).href;
  return { lp: await import(`${url}/index.js`), branch: await import(`${url}/mip/branch.js`), sparse: await import(`${url}/core/sparse.js`) };
};
const builds = { old: await load(oldDir), new: await load(newDir) };
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/** Times f(build) for both builds, alternating which goes first, after a warm-up of each. */
function compare(key, reps, f) {
  const out = { old: [], new: [] };
  const its = { old: f(builds.old), new: f(builds.new) };
  for (let i = 0; i < reps; i++) {
    for (const name of i % 2 ? ['old', 'new'] : ['new', 'old']) {
      const t = performance.now();
      f(builds[name]);
      out[name].push(performance.now() - t);
    }
  }
  const o = median(out.old);
  const n = median(out.new);
  console.log(`${key.padEnd(16)} old ${o.toFixed(2).padStart(8)} ms   new ${n.toFixed(2).padStart(8)} ms   new ÷ old ${(n / o).toFixed(2)}   iterations ${its.old} / ${its.new}`);
}

const dir = new URL('./data', import.meta.url).pathname;
makeData(dir);
for (const { key } of SIZES) {
  const model = builds.new.lp.readMps(readFileSync(`${dir}/${key}.mps`, 'utf8'));
  const { row, col, value } = model.entries;
  const options = { AUb: { rows: model.rowNames.length, cols: model.colNames.length, i: row, j: col, v: value }, bUb: model.rowUp, bounds: model.colNames.map((_, j) => [model.colLo[j], model.colUp[j]]) };
  compare(key, 200, (b) => b.lp.linprogSync(model.c, options).nit);
}
for (const p of MIPS) {
  const made = { old: p.make(builds.old.sparse.fromTriplets), new: p.make(builds.new.sparse.fromTriplets) };
  compare(p.key, p.key.endsWith('20x60') ? 9 : 25, (b) => {
    const m = b === builds.old ? made.old : made.new;
    return b.branch.branchAndBound(m.lp, { integer: m.integer, relGap: 0, nodeLimit: Infinity, timeLimit: Infinity, presolve: true, tol: 1e-7, maxIter: 2 ** 31 - 1 }).nit;
  });
}

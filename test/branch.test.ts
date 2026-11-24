import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromTriplets } from '../src/core/sparse.ts';
import { branchAndBound } from '../src/mip/branch.ts';

/** A seeded generator, so a failure repeats. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

test('reliability branching and the most fractional column prove the same optimum, on random mixed problems', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const n = 4 + Math.floor(r() * 10);
    const m = 2 + Math.floor(r() * 5);
    const ii: number[] = [];
    const jj: number[] = [];
    const vv: number[] = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) if (r() < 0.7) (ii.push(i), jj.push(j), vv.push(1 + Math.floor(r() * 20)));
    const rowUp = Float64Array.from({ length: m }, () => 10 + Math.floor(r() * 40));
    const c = Float64Array.from({ length: n }, () => -(1 + Math.floor(r() * 30)));
    const integer = Uint8Array.from({ length: n }, () => (r() < 0.8 ? 1 : 0));
    const lp = { A: fromTriplets(m, n, ii, jj, vv), c, colLo: new Float64Array(n), colUp: Float64Array.from({ length: n }, () => 1 + Math.floor(r() * 3)), rowLo: new Float64Array(m).fill(-Infinity), rowUp };
    const opts = { integer, relGap: 0, nodeLimit: Infinity, timeLimit: Infinity, presolve: true, tol: 1e-7, maxIter: 2 ** 31 - 1 };
    const a = branchAndBound(lp, { ...opts, branching: 'reliability' });
    const b = branchAndBound(lp, { ...opts, branching: 'mostFractional' });
    assert.equal(a.end, 'optimal', `seed ${seed}`);
    assert.equal(b.end, 'optimal', `seed ${seed}`);
    assert.ok(Math.abs(a.objective! - b.objective!) <= 1e-9 * (1 + Math.abs(b.objective!)), `seed ${seed}: ${a.objective} vs ${b.objective}`);
    for (let j = 0; j < n; j++) if (integer[j]) assert.ok(Number.isInteger(a.x![j]!), `seed ${seed}: x${j} = ${a.x![j]}`);
    // The default is reliability branching.
    assert.equal(branchAndBound(lp, opts).nodes, a.nodes, `seed ${seed}`);
  }
});

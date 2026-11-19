/**
 * Warm starts: the dual simplex started from a basis. A solve's own optimal basis (from the simplex, or from postsolve
 * after presolve) restarts with no iterations; after a bound changes, as branch-and-bound changes them, a warm start
 * reaches the same optimum as a cold one.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { stackCsc } from '../src/core/sparse.ts';
import { solve } from '../src/lp/presolve.ts';
import { dualSimplex, type Lp } from '../src/lp/simplex.ts';

type Num = number | 'Infinity' | '-Infinity';
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/compare.json', import.meta.url), 'utf8'));
const opts = { maxIter: 1e6, primalTol: 1e-7, dualTol: 1e-7 };

/** A compare case's linprog input as a computational-form LP. */
function lpOf(i: { c: number[]; AUb: number[][] | null; bUb: number[] | null; AEq: number[][] | null; bEq: number[] | null; bounds: [number | null, number | null][] }): Lp {
  const n = i.c.length;
  const parts = [];
  if (i.AUb) parts.push({ a: i.AUb, name: 'AUb' });
  if (i.AEq) parts.push({ a: i.AEq, name: 'AEq' });
  const A = stackCsc(parts, n);
  const ub = i.bUb ?? [];
  const eq = i.bEq ?? [];
  return {
    A,
    c: Float64Array.from(i.c),
    colLo: Float64Array.from(i.bounds, ([l]) => l ?? -Infinity),
    colUp: Float64Array.from(i.bounds, ([, u]) => u ?? Infinity),
    rowLo: Float64Array.from([...ub.map(() => -Infinity), ...eq]),
    rowUp: Float64Array.from([...ub, ...eq]),
  };
}
const objective = (lp: Lp, x: Float64Array) => lp.c.reduce((s, c, j) => s + c * x[j]!, 0);
const optimal = fixtures.linprog.filter((k: { scipy: { status: number } }) => k.scipy.status === 0);

test("an optimal basis restarts with no iterations: the simplex's own, and postsolve's", () => {
  for (const k of optimal) {
    const lp = lpOf(k.input);
    for (const presolve of [false, true]) {
      const first = solve(lp, { ...opts, presolve });
      assert.equal(first.status, 0, k.name);
      assert.equal(first.basis!.length, lp.A.rows, `${k.name}: basis size`);
      const again = dualSimplex(lp, { ...opts, basis: first.basis! });
      assert.equal(again.status, 0, `${k.name}, presolve ${presolve}`);
      assert.equal(again.nit, 0, `${k.name}, presolve ${presolve}: ${again.nit} iterations from an optimal basis`);
      const f = objective(lp, first.x);
      assert.ok(Math.abs(objective(lp, again.x) - f) <= 1e-7 * (1 + Math.abs(f)), `${k.name}: objective`);
    }
  }
});

test('after a bound tightens, a warm start reaches the cold optimum', () => {
  let warmIt = 0;
  let coldIt = 0;
  for (const k of optimal) {
    const lp = lpOf(k.input);
    const first = solve(lp, { ...opts, presolve: true });
    // Tighten the bound of the variable furthest inside its bounds, as branching would.
    const n = lp.c.length;
    let j = 0;
    for (let t = 1; t < n; t++) if (Math.abs(first.x[t]! - Math.round(first.x[t]!)) > Math.abs(first.x[j]! - Math.round(first.x[j]!))) j = t;
    for (const side of ['down', 'up']) {
      const colLo = lp.colLo.slice();
      const colUp = lp.colUp.slice();
      if (side === 'down') colUp[j] = Math.min(colUp[j]!, Math.floor(first.x[j]!));
      else colLo[j] = Math.max(colLo[j]!, Math.ceil(first.x[j]!));
      if (colLo[j]! > colUp[j]!) continue;
      const child = { ...lp, colLo, colUp };
      const cold = dualSimplex(child, opts);
      const warm = dualSimplex(child, { ...opts, basis: first.basis! });
      assert.equal(warm.status, cold.status, `${k.name} ${side}`);
      coldIt += cold.nit;
      warmIt += warm.nit;
      if (cold.status !== 0) continue;
      const f = objective(child, cold.x);
      assert.ok(Math.abs(objective(child, warm.x) - f) <= 1e-7 * (1 + Math.abs(f)), `${k.name} ${side}: ${objective(child, warm.x)} vs ${f}`);
    }
  }
  assert.ok(warmIt < coldIt, `warm starts took ${warmIt} iterations, cold ${coldIt}`);
});

test('a basis that is not m distinct variables, or is singular, falls back to a cold start', () => {
  const lp = lpOf(optimal[0].input);
  const cold = dualSimplex(lp, opts);
  const m = lp.A.rows;
  for (const basis of [[], Array(m).fill(0), Array.from({ length: m }, (_, i) => i + 1e6), Array.from({ length: m }, () => 0.5)]) {
    const r = dualSimplex(lp, { ...opts, basis });
    assert.equal(r.status, 0);
    assert.equal(r.nit, cold.nit);
  }
  // Two columns of A that are parallel make a singular basis.
  const A = stackCsc([{ a: [[1, 2], [2, 4]], name: 'A' }], 2);
  const twin: Lp = { A, c: Float64Array.from([-1, -1]), colLo: new Float64Array(2), colUp: Float64Array.from([5, 5]), rowLo: Float64Array.from([-Infinity, -Infinity]), rowUp: Float64Array.from([4, 8]) };
  const r = dualSimplex(twin, { ...opts, basis: [0, 1] });
  assert.equal(r.status, 0);
  assert.ok(Math.abs(objective(twin, r.x) + 4) < 1e-9, `${objective(twin, r.x)}`);
});

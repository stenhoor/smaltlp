/**
 * The compare tests (smaltworks ADR 0039, section 6): smaltlp against the reference results in fixtures/compare.json,
 * which compare/run.py wrote from scipy.optimize.linprog (HiGHS), PuLP (with HiGHS) and HiGHS's MPS reader. No Python
 * runs here.
 *
 * - Every case: the same status, and the same objective within a relative 1e-7.
 * - Cases marked unique (a single optimal solution and a single set of duals): x, the marginals, and PuLP's varValue,
 *   dj, pi and slack too.
 * - MPS files: the model as read, field by field, and the objective where HiGHS solved it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { linprogSync, type Bound } from '../src/index.ts';
import { mpsToProblem, readMps } from '../src/io/index.ts';
import { LpProblem, LpVariable, lpSum, value } from '../src/model/index.ts';

type Num = number | 'Infinity' | '-Infinity';
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/compare.json', import.meta.url), 'utf8'));
const num = (v: Num): number => (v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v);
const TOL = 1e-7;

function close(actual: number | null | undefined, expected: Num, label: string, tol = TOL): void {
  const e = num(expected);
  assert.ok(actual !== null && actual !== undefined, `${label}: no value, expected ${e}`);
  if (!Number.isFinite(e)) return assert.equal(actual, e, label);
  assert.ok(Math.abs(actual - e) <= tol * (1 + Math.abs(e)), `${label}: ${actual} vs ${e}`);
}
function closeAll(actual: ArrayLike<number> | null | undefined, expected: Num[], label: string, tol = TOL): void {
  assert.ok(actual, `${label}: missing`);
  assert.equal(actual.length, expected.length, `${label}: length`);
  expected.forEach((e, i) => close(actual[i], e, `${label}[${i}]`, tol));
}

test(`linprog against scipy ${fixtures.reference.scipy} (HiGHS): ${fixtures.linprog.length} cases`, () => {
  for (const k of fixtures.linprog) {
    const i = k.input;
    const r = linprogSync(i.c, {
      AUb: i.AUb ?? undefined,
      bUb: i.bUb ?? undefined,
      AEq: i.AEq ?? undefined,
      bEq: i.bEq ?? undefined,
      bounds: i.bounds as Bound[],
    });
    assert.equal(r.status, k.scipy.status, `${k.name}: status ${r.status} (${r.message}), scipy ${k.scipy.status}`);
    if (k.scipy.status !== 0) continue;
    close(r.fun, k.scipy.fun, `${k.name}: fun`);
    if (!k.unique) continue;
    closeAll(r.x, k.scipy.x, `${k.name}: x`);
    closeAll(r.ineqlin!.marginals, k.scipy.ineqlin, `${k.name}: ineqlin.marginals`);
    closeAll(r.eqlin!.marginals, k.scipy.eqlin, `${k.name}: eqlin.marginals`);
    closeAll(r.lower!.marginals, k.scipy.lower, `${k.name}: lower.marginals`);
    closeAll(r.upper!.marginals, k.scipy.upper, `${k.name}: upper.marginals`);
  }
});

test(`the modelling layer against PuLP ${fixtures.reference.pulp}: ${fixtures.model.length} cases`, () => {
  for (const { spec, pulp } of fixtures.model) {
    const prob = new LpProblem(spec.name, spec.sense);
    const vars: Record<string, LpVariable> = {};
    for (const v of spec.variables) vars[v.name] = new LpVariable(v.name, { lowBound: v.lowBound ?? null, upBound: v.upBound ?? null });
    prob.add(lpSum(Object.entries(spec.objective as Record<string, number>).map(([n, k]) => vars[n]!.times(k))));
    const cons: Record<string, ReturnType<LpVariable['le']>> = {};
    for (const c of spec.constraints) {
      const lhs = lpSum(Object.entries(c.terms as Record<string, number>).map(([n, k]) => vars[n]!.times(k)));
      cons[c.name] = c.sense === 'le' ? lhs.le(c.rhs) : c.sense === 'ge' ? lhs.ge(c.rhs) : lhs.eq(c.rhs);
      prob.add(cons[c.name]!, c.name);
    }
    const status = prob.solveSync();
    assert.equal(status, pulp.status, `${spec.name}: status ${status}, PuLP ${pulp.status}`);
    if (pulp.status !== 1) continue;
    close(value(prob.objective), pulp.objective, `${spec.name}: objective`);
    if (!spec.unique) continue;
    for (const [n, v] of Object.entries(pulp.varValue as Record<string, Num>)) close(vars[n]!.varValue, v, `${spec.name}: ${n}.varValue`);
    for (const [n, v] of Object.entries(pulp.dj as Record<string, Num>)) close(vars[n]!.dj, v, `${spec.name}: ${n}.dj`);
    for (const [n, v] of Object.entries(pulp.pi as Record<string, Num>)) close(cons[n]!.pi, v, `${spec.name}: ${n}.pi`);
    for (const [n, v] of Object.entries(pulp.slack as Record<string, Num>)) close(cons[n]!.slack, v, `${spec.name}: ${n}.slack`);
  }
});

test(`readMps against HiGHS ${fixtures.reference.highspy}'s reader: ${fixtures.mps.length} files`, () => {
  for (const { name, text, highs } of fixtures.mps) {
    const m = readMps(text);
    assert.equal(m.sense, highs.sense, `${name}: sense`);
    close(m.offset, highs.offset, `${name}: offset`);
    closeAll(m.c, highs.c, `${name}: c`);
    closeAll(m.colLo, highs.colLo, `${name}: colLo`);
    closeAll(m.colUp, highs.colUp, `${name}: colUp`);
    closeAll(m.rowLo, highs.rowLo, `${name}: rowLo`);
    closeAll(m.rowUp, highs.rowUp, `${name}: rowUp`);
    assert.deepEqual([...m.integer], highs.integer, `${name}: integer`);
    if (highs.objective !== undefined) {
      const prob = mpsToProblem(m);
      assert.equal(prob.solveSync(), 1, `${name}: status`);
      close(value(prob.objective), highs.objective, `${name}: objective`);
    }
  }
});

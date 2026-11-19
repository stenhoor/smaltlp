/**
 * The compare tests (smaltworks ADR 0039, section 6): smaltlp against the reference results in fixtures/compare.json,
 * which compare/run.py wrote from scipy.optimize.linprog and milp (HiGHS), PuLP (with HiGHS) and HiGHS's MPS reader.
 * No Python runs here.
 *
 * - Every case: the same status, and the same objective within a relative 1e-7. Integer problems are solved to a gap
 *   of 0 on both sides, so the objective is the optimum; their x (rarely unique) must be whole, in bounds and feasible.
 * - Cases marked unique (a single optimal solution and a single set of duals): x, the marginals, and PuLP's varValue,
 *   dj, pi and slack too.
 * - MPS and LP files: the model as read, field by field, and the objective where HiGHS solved it. LP files HiGHS
 *   refuses fail here too; one it reads by ignoring part of it fails here (LP_FORMAT), on purpose.
 * - Writing: each MPS and LP case written as LP, free MPS and fixed MPS gives the text recorded, HiGHS reads that text
 *   as smaltlp does, and solves it to the original's optimum.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { linprogSync, milpSync, type Bound } from '../src/index.ts';
import { mpsToProblem, readLp, readMps, writeLp, writeMps, type MpsModel } from '../src/io/index.ts';
import { SmaltlpError } from '../src/index.ts';
import { LpMaximize, LpMinimize, LpProblem, type LpConstraint, type LpVariable, lpSum, value } from '../src/model/index.ts';

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

test(`milp against scipy ${fixtures.reference.scipy} (HiGHS): ${fixtures.milp.length} cases`, () => {
  for (const k of fixtures.milp) {
    const i = k.input;
    const lb = (i.lb as Num[]).map(num);
    const ub = (i.ub as Num[]).map(num);
    const cl = i.A ? (i.cl as Num[]).map(num) : [];
    const cu = i.A ? (i.cu as Num[]).map(num) : [];
    const r = milpSync(i.c, {
      integrality: i.integrality,
      bounds: { lb, ub },
      constraints: i.A ? { A: i.A, lb: cl, ub: cu } : undefined,
      mipRelGap: 0,
    });
    assert.equal(r.status, k.scipy.status, `${k.name}: status ${r.status} (${r.message}), scipy ${k.scipy.status}`);
    if (k.scipy.status !== 0) continue;
    close(r.fun, k.scipy.fun, `${k.name}: fun`);
    const x = r.x!;
    (i.c as number[]).forEach((_, j) => {
      if (i.integrality[j]) assert.ok(Number.isInteger(x[j]), `${k.name}: x[${j}] = ${x[j]} is not whole`);
      assert.ok(x[j]! >= lb[j]! - 1e-9 && x[j]! <= ub[j]! + 1e-9, `${k.name}: x[${j}] = ${x[j]} is out of bounds`);
    });
    ((i.A ?? []) as number[][]).forEach((row, r) => {
      const ax = row.reduce((s, a, j) => s + a * x[j]!, 0);
      assert.ok(ax >= cl[r]! - 1e-6 && ax <= cu[r]! + 1e-6, `${k.name}: row ${r} = ${ax} is outside [${cl[r]}, ${cu[r]}]`);
    });
  }
});

test(`the modelling layer against PuLP ${fixtures.reference.pulp}: ${fixtures.model.length} cases`, () => {
  for (const { spec, pulp } of fixtures.model) {
    const prob = new LpProblem(spec.name, spec.sense === 'maximize' ? LpMaximize : LpMinimize);
    const vars: Record<string, LpVariable> = {};
    for (const v of spec.variables) vars[v.name] = prob.addVariable(v.name, v.lowBound ?? null, v.upBound ?? null, v.cat ?? 'Continuous');
    prob.add(lpSum(Object.entries(spec.objective as Record<string, number>).map(([n, k]) => vars[n]!.times(k))));
    const cons: Record<string, LpConstraint> = {};
    for (const c of spec.constraints) {
      const lhs = lpSum(Object.entries(c.terms as Record<string, number>).map(([n, k]) => vars[n]!.times(k)));
      cons[c.name] = c.sense === 'le' ? lhs.le(c.rhs) : c.sense === 'ge' ? lhs.ge(c.rhs) : lhs.eq(c.rhs);
      prob.add(cons[c.name]!, c.name);
    }
    const stats = prob.solveSync({ gapRel: 0 });
    assert.equal(stats.status, pulp.status, `${spec.name}: status ${stats.status}, PuLP ${pulp.status}`);
    assert.equal(stats.statusStr, pulp.statusStr, `${spec.name}: statusStr`);
    assert.equal(stats.hasSolution, pulp.hasSolution, `${spec.name}: hasSolution`);
    if (pulp.status !== 1) continue;
    close(value(prob.objective), pulp.objective, `${spec.name}: objective`);
    close(stats.objective, pulp.objective, `${spec.name}: stats.objective`);
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
      assert.equal(prob.solveSync({ gapRel: 0 }).status, 1, `${name}: status`);
      close(value(prob.objective), highs.objective, `${name}: objective`);
    }
  }
});

interface HighsModel {
  sense: string;
  offset: Num;
  colNames: string[];
  rowNames: string[];
  c: Num[];
  colLo: Num[];
  colUp: Num[];
  rowLo: Num[];
  rowUp: Num[];
  integer: number[];
  entries: [number, number, Num][];
  objective?: Num;
}

/** A read model against HiGHS's reading of the same text, field by field; rows HiGHS named itself aren't checked by name. */
function sameModel(m: MpsModel, h: HighsModel, label: string): void {
  assert.equal(m.sense, h.sense, `${label}: sense`);
  close(m.offset, h.offset, `${label}: offset`);
  assert.deepEqual(m.colNames, h.colNames, `${label}: colNames`);
  h.rowNames.forEach((n, r) => {
    if (!/^HiGHS_R\d+$/.test(n)) assert.equal(m.rowNames[r], n, `${label}: row ${r}'s name`);
  });
  assert.equal(m.rowNames.length, h.rowNames.length, `${label}: rows`);
  closeAll(m.c, h.c, `${label}: c`);
  closeAll(m.colLo, h.colLo, `${label}: colLo`);
  closeAll(m.colUp, h.colUp, `${label}: colUp`);
  closeAll(m.rowLo, h.rowLo, `${label}: rowLo`);
  closeAll(m.rowUp, h.rowUp, `${label}: rowUp`);
  assert.deepEqual([...m.integer], h.integer, `${label}: integer`);
  const ours = new Map<string, number>();
  for (let k = 0; k < m.entries.value.length; k++) {
    const key = `${m.entries.row[k]},${m.entries.col[k]}`;
    ours.set(key, (ours.get(key) ?? 0) + m.entries.value[k]!);
  }
  for (const [key, v] of [...ours]) if (v === 0) ours.delete(key);
  assert.equal(ours.size, h.entries.length, `${label}: the matrix's entries`);
  for (const [r, j, v] of h.entries) close(ours.get(`${r},${j}`), v, `${label}: A[${r}][${j}]`);
}

function solved(m: MpsModel, h: HighsModel, label: string): void {
  if (h.objective === undefined) return;
  const prob = mpsToProblem(m);
  assert.equal(prob.solveSync({ gapRel: 0 }).status, 1, `${label}: status`);
  close(value(prob.objective), h.objective, `${label}: objective`);
}

test(`readLp against HiGHS ${fixtures.reference.highspy}'s LP reader: ${fixtures.lp.length} files, and the files it refuses`, () => {
  for (const { name, text, highs } of fixtures.lp) {
    const m = readLp(text);
    sameModel(m, highs, name);
    solved(m, highs, name);
  }
  for (const { name, text, highs } of fixtures.lpRejected) {
    assert.equal(highs, null, `${name}: HiGHS refused it when the fixtures were made`);
    assert.throws(() => readLp(text), (e: unknown) => e instanceof SmaltlpError && e.code === 'LP_FORMAT', `${name}: LP_FORMAT`);
  }
  for (const { name, text, highs } of fixtures.lpDivergent) {
    assert.ok(highs, `${name}: HiGHS reads it (ignoring part of it)`);
    assert.throws(() => readLp(text), (e: unknown) => e instanceof SmaltlpError && e.code === 'LP_FORMAT', `${name}: LP_FORMAT`);
  }
});

test(`writeLp and writeMps, read back by HiGHS ${fixtures.reference.highspy}: ${fixtures.written.length} models, three ways each`, () => {
  const source = new Map<string, { text: string; highs: HighsModel }>();
  for (const k of fixtures.mps) source.set(`mps:${k.name}`, k);
  for (const k of fixtures.lp) source.set(`lp:${k.name}`, k);
  for (const w of fixtures.written) {
    const src = source.get(w.case)!;
    const original = w.case.startsWith('mps:') ? readMps(src.text) : readLp(src.text);
    const texts: Record<string, string> = {
      lp: writeLp(original),
      mps: writeMps(original),
      mpsFixed: writeMps(original, { format: 'fixed' }),
    };
    for (const kind of ['lp', 'mps', 'mpsFixed'] as const) {
      const label = `${w.case} as ${kind}`;
      assert.ok(w[kind], `${label}: written when the fixtures were made`);
      assert.equal(texts[kind], w[kind].text, `${label}: the text written (rerun npm run compare after changing a writer)`);
      const back = kind === 'lp' ? readLp(texts[kind]!) : readMps(texts[kind]!, { format: kind === 'mpsFixed' ? 'fixed' : 'free' });
      sameModel(back, w[kind].highs, label);
      if (src.highs.objective !== undefined) close(num(w[kind].highs.objective!), src.highs.objective, `${label}: HiGHS's optimum of the written file`);
    }
  }
});

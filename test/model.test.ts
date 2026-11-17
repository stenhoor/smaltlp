import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linprogSync, SmaltlpError } from '../src/index.ts';
import { LpProblem, LpStatus, LpVariable, lpDot, lpSum, value } from '../src/model/index.ts';

function near(a: number | null | undefined, b: number, tol = 1e-9): void {
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol * (1 + Math.abs(b)), `${a} is not ${b}`);
}

function plan() {
  const prob = new LpProblem('plan', 'maximize');
  const x = new LpVariable('x', { lowBound: 0 });
  const y = new LpVariable('y', { lowBound: 0 });
  prob.add(x.times(3).plus(y.times(5)));
  const c1 = x.le(4);
  const c2 = y.times(2).le(12);
  const c3 = x.times(3).plus(y.times(2)).le(18);
  prob.add(c1, 'plant1').add(c2, 'plant2').add(c3, 'plant3');
  return { prob, x, y, c1, c2, c3 };
}

test('a production plan, maximized: values, objective, duals and slacks', () => {
  const { prob, x, y, c1, c2, c3 } = plan();
  const status = prob.solveSync();
  assert.equal(status, 1);
  assert.equal(LpStatus[status], 'Optimal');
  near(x.varValue, 2);
  near(y.varValue, 6);
  near(value(prob.objective), 36);
  // Shadow prices in the problem's own sense: a unit more of plant 2 and plant 3 is worth 3/2 and 1.
  near(c1.pi, 0);
  near(c2.pi, 1.5);
  near(c3.pi, 1);
  near(c1.slack, 2);
  near(c2.slack, 0);
  near(c3.slack, 0);
  assert.deepEqual([...prob.constraints.keys()], ['plant1', 'plant2', 'plant3']);
});

test('the modelling layer and linprog agree', () => {
  const { prob, x, y } = plan();
  prob.solveSync();
  const r = linprogSync([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
  near(x.varValue, r.x![0]!);
  near(y.varValue, r.x![1]!);
  near(-value(prob.objective)!, r.fun!);
});

test('≥ and = constraints, constants on both sides, and reduced costs', () => {
  // min 2a + 3b + c, a + b ≥ 4 written as a + b + 1 ≥ 5, b - c = 1, c ≤ 10 (bound), all ≥ 0.
  const prob = new LpProblem('mix');
  const a = new LpVariable('a', { lowBound: 0 });
  const b = new LpVariable('b', { lowBound: 0 });
  const c = new LpVariable('c', { lowBound: 0, upBound: 10 });
  prob.add(lpDot([2, 3, 1], [a, b, c]));
  const need = a.plus(b, 1).ge(5);
  const link = b.minus(c).eq(1);
  prob.add(need, 'need').add(link);
  assert.equal(prob.solveSync(), 1);
  // b costs 3 plus c's 1 dragged along: a (2) is cheaper, so a = 3, b = 1, c = 0.
  near(a.varValue, 3);
  near(b.varValue, 1);
  near(c.varValue, 0);
  near(value(prob.objective), 9);
  near(need.pi, 2);
  near(need.slack, 0);
  assert.equal(link.name, '_C2');
  // c is at its lower bound: raising it by one costs 1 plus b's 3 and saves a's 2: dj 2.
  near(c.dj, 2);
  near(a.dj, 0);
});

test('lpSum, expressions and toString', () => {
  const vs = ['p', 'q', 'r'].map((n) => new LpVariable(n, { lowBound: 0, upBound: 1 }));
  const e = lpSum(vs).times(2).minus(1);
  assert.equal(e.toString(), '2*p + 2*q + 2*r - 1');
  assert.equal(e.terms.get(vs[1]!), 2);
  const prob = new LpProblem('pick', 'maximize');
  prob.add(e).add(lpSum(vs).le(2), 'atMostTwo');
  assert.equal(prob.solveSync(), 1);
  near(value(e), 3);
});

test('a problem without an objective finds a feasible point', () => {
  const prob = new LpProblem('feasible');
  const x = new LpVariable('x');
  prob.add(x.ge(3)).add(x.le(5));
  assert.equal(prob.solveSync(), 1);
  assert.ok(x.varValue! >= 3 - 1e-9 && x.varValue! <= 5 + 1e-9);
  assert.equal(value(prob.objective), null);
});

test('infeasible and unbounded problems: PuLP status codes, and no values', () => {
  const p1 = new LpProblem('infeasible');
  const x = new LpVariable('x', { lowBound: 0 });
  p1.add(x).add(x.le(-1));
  assert.equal(p1.solveSync(), -1);
  assert.equal(LpStatus[p1.status], 'Infeasible');
  assert.equal(x.varValue, null);
  const p2 = new LpProblem('unbounded', 'maximize');
  p2.add(x);
  assert.equal(p2.solveSync(), -2);
  assert.equal(LpStatus[-2], 'Unbounded');
  const p3 = new LpProblem('crossed');
  p3.add(new LpVariable('z', { lowBound: 2, upBound: 1 }).ge(0));
  assert.equal(p3.solveSync(), -1);
});

test('the asynchronous solve gives exactly the synchronous result', async () => {
  const a = plan();
  const b = plan();
  assert.equal(await a.prob.solve(), b.prob.solveSync());
  assert.equal(a.x.varValue, b.x.varValue);
  assert.equal(a.c3.pi, b.c3.pi);
});

test('bad models fail with a code', () => {
  const code = (fn: () => unknown, c: string) => assert.throws(fn, (e: unknown) => e instanceof SmaltlpError && e.code === c);
  code(() => new LpVariable(''), 'LP_PARAM');
  code(() => new LpVariable('two words'), 'LP_PARAM');
  code(() => new LpVariable('x', { lowBound: NaN }), 'LP_VALUE');
  code(() => new LpVariable('x').times(Infinity), 'LP_VALUE');
  code(() => new LpProblem('p', 'max' as never), 'LP_PARAM');
  const p = new LpProblem('dup');
  p.add(new LpVariable('x').ge(0), 'c');
  code(() => p.add(new LpVariable('y').ge(0), 'c'), 'LP_PARAM');
  const twins = new LpProblem('twins');
  twins.add(new LpVariable('x').plus(new LpVariable('x')).ge(0));
  code(() => twins.solveSync(), 'LP_PARAM');
  const int = new LpProblem('int');
  int.add(new LpVariable('n', { cat: 'Integer' }).ge(1));
  code(() => int.solveSync(), 'LP_UNSUPPORTED');
  const bin = new LpVariable('b', { cat: 'Binary' });
  assert.equal(bin.lowBound, 0);
  assert.equal(bin.upBound, 1);
});

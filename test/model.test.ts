import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linprogSync, SmaltlpError } from '../src/index.ts';
import {
  LpConstraintEQ,
  LpConstraintGE,
  LpConstraintLE,
  LpMaximize,
  LpMinimize,
  LpProblem,
  LpSolveStatus,
  LpVariable,
  lpDot,
  lpSum,
  value,
} from '../src/model/index.ts';

function near(a: number | null | undefined, b: number, tol = 1e-9): void {
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol * (1 + Math.abs(b)), `${a} is not ${b}`);
}

function plan() {
  const prob = new LpProblem('plan', LpMaximize);
  const x = prob.addVariable('x', 0);
  const y = prob.addVariable('y', 0);
  prob.add(x.times(3).plus(y.times(5)));
  prob.add(x.le(4), 'plant1').add(y.times(2).le(12), 'plant2').add(x.times(3).plus(y.times(2)).le(18), 'plant3');
  return { prob, x, y };
}

test('a production plan, maximized: stats, values, objective, duals and slacks', () => {
  const { prob, x, y } = plan();
  const stats = prob.solveSync();
  assert.equal(stats.status, LpSolveStatus.Optimal);
  assert.equal(stats.statusStr, 'Optimal');
  assert.equal(stats.hasSolution, true);
  assert.equal(stats.solver, 'smaltlp');
  assert.equal(stats.numVariables, 2);
  assert.equal(stats.numConstraints, 3);
  assert.equal(stats.isMip, false);
  near(stats.objective, 36);
  near(x.varValue, 2);
  near(y.varValue, 6);
  near(value(prob.objective), 36);
  const [c1, c2, c3] = prob.constraints();
  // Shadow prices in the problem's own sense: a unit more of plant 2 and plant 3 is worth 3/2 and 1.
  near(c1!.pi, 0);
  near(c2!.pi, 1.5);
  near(c3!.pi, 1);
  near(c1!.slack, 2);
  near(c2!.slack, 0);
  near(c3!.slack, 0);
  assert.deepEqual(prob.constraints().map((c) => c.name), ['plant1', 'plant2', 'plant3']);
  assert.equal(prob.getConstraintByName('plant3'), c3);
  assert.equal(prob.getConstraintByName('nope'), null);
  assert.equal(c1!.sense, LpConstraintLE);
  assert.equal(c1!.constant, -4);
  assert.equal(c3!.toString(), '3*x + 2*y <= 18');
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
  // min 2a + 3b + c, a + b ≥ 4 written as a + b + 1 ≥ 5, b - c = 1, c ≤ 10, all ≥ 0.
  const prob = new LpProblem('mix');
  const a = prob.addVariable('a', 0);
  const b = prob.addVariable('b', 0);
  const c = prob.addVariable('c', 0, 10);
  prob.add(lpDot([2, 3, 1], [a, b, c]));
  const need = prob.addConstraint(a.plus(b, 1).ge(5), 'need');
  const link = prob.addConstraint(b.minus(c).eq(1));
  assert.equal(prob.solveSync().status, LpSolveStatus.Optimal);
  // b costs 3 plus c's 1 dragged along: a (2) is cheaper, so a = 3, b = 1, c = 0.
  near(a.varValue, 3);
  near(b.varValue, 1);
  near(c.varValue, 0);
  near(value(prob.objective), 9);
  near(need.pi, 2);
  near(need.slack, 0);
  assert.equal(need.sense, LpConstraintGE);
  assert.equal(link.name, '_C2');
  assert.equal(link.sense, LpConstraintEQ);
  // c is at its lower bound: raising it by one costs 1 plus b's 3 and saves a's 2: dj 2.
  near(c.dj, 2);
  near(a.dj, 0);
});

test('lpSum, expressions and toString', () => {
  const prob = new LpProblem('pick', LpMaximize);
  const vs = ['p', 'q', 'r'].map((n) => prob.addVariable(n, 0, 1));
  const e = lpSum(vs).times(2).minus(1);
  assert.equal(e.toString(), '2*p + 2*q + 2*r - 1');
  assert.equal(e.terms.get(vs[1]!), 2);
  prob.add(e).add(lpSum(vs).le(2), 'atMostTwo');
  assert.equal(prob.solveSync().status, LpSolveStatus.Optimal);
  near(value(e), 3);
});

test('variables(): every variable added, used or not; spaces become underscores; Binary is 0 to 1', () => {
  const prob = new LpProblem('vars');
  const a = prob.addVariable('a', 0);
  prob.addVariable('unused');
  const s = prob.addVariable('two words', 1, 2);
  const b = prob.addVariable('flag', 5, 9, 'Binary');
  assert.deepEqual(prob.variables().map((v) => v.name), ['a', 'unused', 'two_words', 'flag']);
  assert.equal(s.name, 'two_words');
  assert.equal(b.lowBound, 0);
  assert.equal(b.upBound, 1);
  assert.equal(prob.isMIP(), true);
  assert.equal(prob.numVariables(), 4);
  assert.equal(a.problem, prob);
});

test('a problem without an objective finds a feasible point', () => {
  const prob = new LpProblem('feasible');
  const x = prob.addVariable('x');
  prob.add(x.ge(3)).add(x.le(5));
  const stats = prob.solveSync();
  assert.equal(stats.status, LpSolveStatus.Optimal);
  assert.equal(stats.objective, 0);
  assert.ok(x.varValue! >= 3 - 1e-9 && x.varValue! <= 5 + 1e-9);
  assert.equal(prob.objective, null);
  assert.equal(value(prob.objective), null);
});

test('infeasible, unbounded and iteration-limit statuses, as PuLP 4.2 codes them, with no values', () => {
  const p1 = new LpProblem('infeasible');
  const x = p1.addVariable('x', 0);
  p1.add(x).add(x.le(-1));
  const s1 = p1.solveSync();
  assert.equal(s1.status, LpSolveStatus.Infeasible);
  assert.equal(s1.statusStr, 'Infeasible');
  assert.equal(s1.hasSolution, false);
  assert.equal(s1.objective, null);
  assert.equal(x.varValue, null);
  const p2 = new LpProblem('unbounded', LpMaximize);
  p2.add(p2.addVariable('w', 0));
  assert.equal(p2.solveSync().status, LpSolveStatus.Unbounded);
  const p3 = new LpProblem('crossed');
  p3.add(p3.addVariable('z', 2, 1).ge(0));
  assert.equal(p3.solveSync().status, LpSolveStatus.Infeasible);
  const { prob } = plan();
  const s4 = prob.solveSync({ maxIter: 0 });
  assert.equal(s4.status, LpSolveStatus.IterationLimit);
  assert.equal(s4.statusStr, 'IterationLimit');
});

test('the asynchronous solve gives the synchronous result', async () => {
  const a = plan();
  const b = plan();
  const sa = await a.prob.solve();
  const sb = b.prob.solveSync();
  assert.deepEqual({ ...sa, time: 0 }, { ...sb, time: 0 });
  assert.equal(a.x.varValue, b.x.varValue);
  assert.equal(a.prob.constraints()[2]!.pi, b.prob.constraints()[2]!.pi);
});

test('bad models fail with a code', () => {
  const code = (fn: () => unknown, c: string) => assert.throws(fn, (e: unknown) => e instanceof SmaltlpError && e.code === c);
  const p = new LpProblem('p', LpMinimize);
  code(() => p.addVariable(''), 'LP_PARAM');
  code(() => p.addVariable('x', NaN), 'LP_VALUE');
  code(() => p.addVariable('x', -Infinity), 'LP_VALUE');
  code(() => p.addVariable('x', 0, Infinity), 'LP_VALUE');
  code(() => p.addVariable('x', 0, null, 'Real' as never), 'LP_PARAM');
  code(() => p.addVariable('x').times(Infinity), 'LP_VALUE');
  code(() => new LpProblem('p', 2 as never), 'LP_PARAM');
  code(() => new (LpVariable as unknown as new (...a: unknown[]) => unknown)(Symbol('x'), p, 'x', null, null, 'Continuous'), 'LP_PARAM');
  p.add(p.addVariable('a').ge(0), 'c');
  code(() => p.add(p.addVariable('b').ge(0), 'c'), 'LP_PARAM');
  const other = new LpProblem('other');
  const foreign = other.addVariable('f');
  code(() => p.add(foreign.ge(1)), 'LP_PARAM');
  code(() => p.add(foreign), 'LP_PARAM');
  const int = new LpProblem('int');
  int.add(int.addVariable('n', 0, null, 'Integer').ge(1));
  code(() => int.solveSync(), 'LP_UNSUPPORTED');
});

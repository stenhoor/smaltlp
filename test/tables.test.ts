import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LpMaximize, LpMinimize, LpProblem, LpSolveStatus, SmaltlpError } from '../src/index.ts';
import { addConstraints, addVariables, constraintRows, dotColumn, variableRows, withColumn } from '../src/tables/index.ts';

function code(fn: () => unknown, expected: string): void {
  assert.throws(fn, (e: unknown) => e instanceof SmaltlpError && e.code === expected);
}

// A production plan as tables: products (as smaltdb's db.query() gives rows), the resources' limits, and the hours
// each product takes of each resource (long format).
const products = [
  { product: 'tables', profit: 3, most: 4n },
  { product: 'chairs', profit: 5, most: null },
];
const limits = { columns: ['resource', 'sense', 'available'], rows: [['plant1', '<=', 4], ['plant2', 'le', 12], ['plant3', '<=', 18]] };
const uses = [
  { resource: 'plant1', product: 'tables', hours: 1 },
  { resource: 'plant2', product: 'chairs', hours: 2 },
  { resource: 'plant3', product: 'tables', hours: 3 },
  { resource: 'plant3', product: 'chairs', hours: 2 },
];

test('a model from tables solves as the same model built by hand, and the answers come back as rows', () => {
  const prob = new LpProblem('plan', LpMaximize);
  const make = addVariables(prob, products, { name: 'product', lowBound: 0, upBound: 'most' });
  assert.deepEqual(make.map((v) => [v.name, v.lowBound, v.upBound, v.cat]), [['tables', 0, 4, 'Continuous'], ['chairs', 0, null, 'Continuous']]);
  prob.add(dotColumn(products, 'profit', make));
  const cons = addConstraints(prob, { rows: limits, name: 'resource', sense: 'sense', rhs: 'available' }, { rows: uses, constraint: 'resource', variable: 'product', coefficient: 'hours' });
  assert.deepEqual(cons.map((c) => c.toString()), ['tables <= 4', '2*chairs <= 12', '3*tables + 2*chairs <= 18']);
  assert.equal(prob.solveSync().status, LpSolveStatus.Optimal);
  assert.deepEqual(variableRows(prob), [{ name: 'tables', varValue: 2, dj: 0 }, { name: 'chairs', varValue: 6, dj: 0 }]);
  assert.deepEqual(constraintRows(prob), [{ name: 'plant1', pi: 0, slack: 2 }, { name: 'plant2', pi: 1.5, slack: 0 }, { name: 'plant3', pi: 1, slack: 0 }]);
  assert.deepEqual(withColumn(products, make, 'make'), [{ ...products[0], make: 2 }, { ...products[1], make: 6 }]);
});

test("{ columns, rows } tables (smaltdf's collect()), categories from a column, a fixed sense, summed terms", () => {
  const items = { columns: ['item', 'kind', 'worth', 'weight'], rows: [['a', 'Binary', 10, 11], ['b', 'Binary', 13, 15], ['c', 'Integer', 7, 10]] };
  const prob = new LpProblem('pack', LpMaximize);
  const take = addVariables(prob, items, { name: 'item', lowBound: 0, upBound: 1, cat: 'kind' });
  assert.deepEqual(take.map((v) => v.cat), ['Binary', 'Binary', 'Integer']);
  prob.add(dotColumn(items, 'worth', take));
  addConstraints(
    prob,
    { rows: [{ limit: 'cap', most: 26 }], name: 'limit', sense: '<=', rhs: 'most' },
    { rows: [{ limit: 'cap', item: 'a', w: 5 }, { limit: 'cap', item: 'a', w: 6 }, { limit: 'cap', item: 'b', w: 15 }, { limit: 'cap', item: 'c', w: 10 }], constraint: 'limit', variable: 'item', coefficient: 'w' },
  );
  assert.equal(prob.getConstraintByName('cap')!.toString(), '11*a + 15*b + 10*c <= 26');
  prob.solveSync({ gapRel: 0 });
  assert.deepEqual(variableRows(prob).map((r) => r.varValue), [1, 1, 0]);
});

test('bad tables fail with a code, naming the row and column', () => {
  const prob = new LpProblem('x', LpMinimize);
  code(() => addVariables(prob, products, {} as never), 'LP_PARAM');
  code(() => addVariables(prob, products, { name: 'nope' }), 'LP_PARAM');
  code(() => addVariables(prob, [{ n: '' }], { name: 'n' }), 'LP_VALUE');
  code(() => addVariables(prob, [{ n: 'a', lo: 'x' }], { name: 'n', lowBound: 'lo' }), 'LP_VALUE');
  code(() => addVariables(prob, [{ n: 'a', k: 'Real' }], { name: 'n', cat: 'k' }), 'LP_VALUE');
  code(() => addVariables(prob, [{ n: 'a' }, { n: 'a' }], { name: 'n' }), 'LP_PARAM');
  code(() => addVariables(prob, { columns: ['n'], rows: [['a', 'b']] }, { name: 'n' }), 'LP_SHAPE');
  code(() => addVariables(prob, 'rows' as never, { name: 'n' }), 'LP_PARAM');
  const p2 = new LpProblem('y', LpMinimize);
  const v = addVariables(p2, products, { name: 'product' });
  code(() => dotColumn(products, 'profit', v.slice(1)), 'LP_SHAPE');
  code(() => dotColumn([{ profit: Infinity }, { profit: 1 }], 'profit', v), 'LP_VALUE');
  const lim = { rows: [{ r: 'c', s: '<', b: 1 }], name: 'r', sense: 's', rhs: 'b' };
  const terms = { rows: [{ r: 'c', v: 'tables', a: 1 }], constraint: 'r', variable: 'v', coefficient: 'a' };
  code(() => addConstraints(p2, lim, terms), 'LP_VALUE');
  code(() => addConstraints(p2, { ...lim, sense: '<=' }, { ...terms, rows: [{ r: 'other', v: 'tables', a: 1 }] }), 'LP_PARAM');
  code(() => addConstraints(p2, { ...lim, sense: '<=' }, { ...terms, rows: [{ r: 'c', v: 'missing', a: 1 }] }), 'LP_PARAM');
  code(() => addConstraints(p2, { ...lim, sense: '<=', rows: [{ r: 'c', b: 1 }, { r: 'c', b: 2 }] }, terms), 'LP_PARAM');
  code(() => withColumn(products, v.slice(1)), 'LP_SHAPE');
});

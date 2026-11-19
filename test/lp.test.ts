import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mpsToProblem, problemToModel, readLp, readMps, writeLp, writeMps, type MpsModel } from '../src/io/index.ts';
import { LpMaximize, LpProblem, lpSum, SmaltlpError, value } from '../src/index.ts';

function code(fn: () => unknown, expected: string, line?: number): void {
  assert.throws(fn, (e: unknown) => {
    if (!(e instanceof SmaltlpError) || e.code !== expected) return false;
    return line === undefined || e.message.includes(`line ${line}:`);
  });
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** The model by names: each column's cost, bounds and kind, each row's range and entries. */
function byName(m: MpsModel) {
  const z = (v: number) => v + 0;
  const cols = new Map(m.colNames.map((n, j) => [n, [z(m.c[j]!), z(m.colLo[j]!), z(m.colUp[j]!), m.integer[j]]]));
  const rows = new Map(m.rowNames.map((n, r) => [n, { lo: z(m.rowLo[r]!), up: z(m.rowUp[r]!), terms: new Map<string, number>() }]));
  for (let k = 0; k < m.entries.value.length; k++) {
    const t = rows.get(m.rowNames[m.entries.row[k]!]!)!.terms;
    const cn = m.colNames[m.entries.col[k]!]!;
    t.set(cn, (t.get(cn) ?? 0) + m.entries.value[k]!);
  }
  return { sense: m.sense, offset: z(m.offset), cols, rows };
}

/** A random model with names LP and fixed MPS can hold, ranged rows only where `ranges` (LP writes them as two). */
function randomModel(seed: number, ranges: boolean): MpsModel {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 7);
  const m = Math.floor(r() * 6);
  const num = () => Math.round((r() * 20 - 10) * 8) / 8;
  const lo: number[] = [];
  const up: number[] = [];
  const integer: number[] = [];
  for (let j = 0; j < n; j++) {
    const k = r();
    const isInt = r() < 0.3 ? 1 : 0;
    integer.push(isInt);
    if (k < 0.3) (lo.push(0), up.push(Infinity));
    else if (k < 0.45) (lo.push(-Infinity), up.push(Infinity));
    else if (k < 0.6) (lo.push(0), up.push(1));
    else if (k < 0.7) {
      const v = Math.round(num());
      lo.push(v);
      up.push(v);
    } else if (k < 0.8) (lo.push(-Infinity), up.push(Math.round(num())));
    else {
      const a = Math.round(num());
      lo.push(a);
      up.push(a + 1 + Math.floor(r() * 5));
    }
  }
  const rowLo: number[] = [];
  const rowUp: number[] = [];
  for (let i = 0; i < m; i++) {
    const k = r();
    const b = num();
    if (k < 0.35) (rowLo.push(-Infinity), rowUp.push(b));
    else if (k < 0.65) (rowLo.push(b), rowUp.push(Infinity));
    else if (k < 0.85 || !ranges) (rowLo.push(b), rowUp.push(b));
    else (rowLo.push(b), rowUp.push(b + 2.5));
  }
  const ei: number[] = [];
  const ej: number[] = [];
  const ev: number[] = [];
  for (let i = 0; i < m; i++) {
    let any = false;
    for (let j = 0; j < n; j++) if (r() < 0.5) (ei.push(i), ej.push(j), ev.push(num() || 1), (any = true));
    if (!any) (ei.push(i), ej.push(0), ev.push(1));
  }
  return {
    name: `R${seed}`,
    sense: r() < 0.5 ? 'minimize' : 'maximize',
    objectiveName: 'obj',
    offset: r() < 0.3 ? num() : 0,
    rowNames: Array.from({ length: m }, (_, i) => `row${i}`),
    rowLo: Float64Array.from(rowLo),
    rowUp: Float64Array.from(rowUp),
    colNames: Array.from({ length: n }, (_, j) => `x${j}`),
    c: Float64Array.from({ length: n }, () => (r() < 0.7 ? num() : 0)),
    colLo: Float64Array.from(lo),
    colUp: Float64Array.from(up),
    integer: Uint8Array.from(integer),
    entries: { row: Int32Array.from(ei), col: Int32Array.from(ej), value: Float64Array.from(ev) },
  };
}

test('random models round-trip through writeLp, free and fixed writeMps, by name', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const withRanges = randomModel(seed, true);
    const want = byName(withRanges);
    assert.deepEqual(byName(readMps(writeMps(withRanges))), want, `seed ${seed}: free MPS`);
    assert.deepEqual(byName(readMps(writeMps(withRanges, { format: 'fixed' }), { format: 'fixed' })), want, `seed ${seed}: fixed MPS`);
    // LP holds no ranged row: a model without them reads back as it was.
    const plain = randomModel(seed, false);
    assert.deepEqual(byName(readLp(writeLp(plain))), byName(plain), `seed ${seed}: LP`);
  }
});

test("writeLp writes a ranged row as two, as HiGHS does, and leaves out a free row", () => {
  const m = randomModel(3, false);
  const ranged: MpsModel = { ...m, rowNames: ['r'], rowLo: Float64Array.of(-2), rowUp: Float64Array.of(3), entries: { row: Int32Array.of(0, 0), col: Int32Array.of(0, 0), value: Float64Array.of(1, 1) } };
  const back = readLp(writeLp(ranged));
  assert.deepEqual(back.rowNames, ['rlo', 'rup']);
  assert.deepEqual([...back.rowLo, ...back.rowUp], [-2, -Infinity, Infinity, 3]);
  assert.deepEqual([...back.entries.value], [2, 2]);
  const free: MpsModel = { ...ranged, rowLo: Float64Array.of(-Infinity), rowUp: Float64Array.of(Infinity) };
  assert.deepEqual(readLp(writeLp(free)).rowNames, []);
});

test('a model written and read back solves to the same answer', () => {
  const prob = new LpProblem('plan', LpMaximize);
  const tables = prob.addVariable('tables', 0, null, 'Integer');
  const chairs = prob.addVariable('chairs', 0);
  const flag = prob.addVariable('flag', null, null, 'Binary');
  prob.add(lpSum([tables.times(3), chairs.times(5), flag.times(2)]).plus(1));
  prob.add(tables.le(4), 'plant1');
  prob.add(chairs.times(2).le(12), 'plant2');
  prob.add(lpSum([tables.times(3), chairs.times(2), flag]).le(18.5), 'plant3');
  prob.add(chairs.minus(tables).ge(-10), 'balance');
  prob.add(tables.plus(chairs).eq(7), 'total');
  const model = problemToModel(prob);
  assert.deepEqual(model.colNames, ['tables', 'chairs', 'flag']);
  assert.deepEqual([...model.integer], [1, 0, 1]);
  assert.equal(model.offset, 1);
  const want = prob.solveSync({ gapRel: 0 });
  for (const text of [writeLp(model), writeMps(model), writeMps(model, { format: 'fixed' })]) {
    const again = mpsToProblem(text.startsWith('\\') ? readLp(text) : readMps(text, { format: text.startsWith('NAME          ') ? 'fixed' : 'free' }));
    const got = again.solveSync({ gapRel: 0 });
    assert.equal(got.status, want.status);
    assert.equal(value(again.objective), value(prob.objective));
  }
});

test('LP files that break the format fail with LP_FORMAT, naming the line', () => {
  code(() => readLp('Subject To\n c: x <= 1\nEnd'), 'LP_FORMAT', 1);
  code(() => readLp('Minimize\n obj: x\nSubject To\n c: x + y\nEnd'), 'LP_FORMAT', 5);
  code(() => readLp('Minimize\n obj: x\nSubject To\n c: x <= \nEnd'), 'LP_FORMAT');
  code(() => readLp('Minimize\n obj: x\nSubject To\n c: x - <= 1\nEnd'), 'LP_FORMAT', 4);
  code(() => readLp('Minimize\n obj: x\nSubject To\n c: <= 1\nEnd'), 'LP_FORMAT', 4);
  code(() => readLp('Minimize\n obj: x\nBounds\n x frees\nEnd'), 'LP_FORMAT', 4);
  code(() => readLp('Minimize\n obj: x\nBounds\n x = inf\nEnd'), 'LP_FORMAT', 4);
  code(() => readLp('Minimize\n obj: x\nBounds\n x >= inf\nEnd'), 'LP_FORMAT', 4);
  code(() => readLp('Minimize\n obj: x\nGenerals\n 3\nEnd'), 'LP_FORMAT', 4);
  code(() => readLp('Minimize\n obj: x $ y\nEnd'), 'LP_FORMAT', 2);
  code(() => readLp('Minimize\n obj: x\nSubject To\n c: x + inf <= 2\nEnd'), 'LP_FORMAT', 4);
  code(() => readLp('\\ only a comment\n'), 'LP_FORMAT');
  code(() => readLp(42 as never), 'LP_PARAM');
});

test("LP files with what smaltlp doesn't have fail with LP_UNSUPPORTED", () => {
  code(() => readLp('Minimize\n obj: x + [ x ^ 2 ] / 2\nEnd'), 'LP_UNSUPPORTED', 2);
  code(() => readLp('Minimize\n obj: x\nSubject To\n c: b = 1 -> x >= 2\nEnd'), 'LP_UNSUPPORTED', 4);
  code(() => readLp('Minimize\n obj: x\nSemi-Continuous\n x\nEnd'), 'LP_UNSUPPORTED', 3);
  code(() => readLp('Minimize\n obj: x\nSOS\n s1: S1:: x:1\nEnd'), 'LP_UNSUPPORTED', 3);
});

test("names and numbers a format can't hold fail with LP_VALUE", () => {
  const m = randomModel(5, false);
  for (const bad of ['2x', 'has space', 'e12', 'free', 'Subject To', '.x', '']) {
    code(() => writeLp({ ...m, colNames: [bad, ...m.colNames.slice(1)] }), 'LP_VALUE');
  }
  code(() => writeMps({ ...m, colNames: ['has space', ...m.colNames.slice(1)] }), 'LP_VALUE');
  code(() => writeMps({ ...m, colNames: ['ninechars', ...m.colNames.slice(1)] }, { format: 'fixed' }), 'LP_VALUE');
  assert.ok(writeMps({ ...m, colNames: ['ninechars', ...m.colNames.slice(1)] }).includes('ninechars'));
  code(() => writeMps({ ...m, c: Float64Array.from(m.c, () => 0.1 + 0.2) }, { format: 'fixed' }), 'LP_VALUE');
  code(() => writeMps(m, { format: 'loose' as never }), 'LP_PARAM');
});

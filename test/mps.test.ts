import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SmaltlpError } from '../src/index.ts';
import { mpsToProblem, readMps } from '../src/io/index.ts';
import { value } from '../src/model/index.ts';

function near(a: number | null | undefined, b: number, tol = 1e-9): void {
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol * (1 + Math.abs(b)), `${a} is not ${b}`);
}

// min x + 2y + 3z: x + y ≤ 4, x + z ≥ 1, −y + z = 7, x in [0, 4], y in [−1, 1], z ≥ 0.
// By hand: z = 7 + y, so the cost is x + 5y + 21: y = −1, z = 6, x = 0, cost 16.
const TESTPROB = `NAME          TESTPROB
ROWS
 N  COST
 L  LIM1
 G  LIM2
 E  MYEQN
COLUMNS
    XONE      COST         1   LIM1         1
    XONE      LIM2         1
    YTWO      COST         2   LIM1         1
    YTWO      MYEQN       -1
    ZTHREE    COST         3   LIM2         1
    ZTHREE    MYEQN        1
RHS
    RHS1      LIM1         4   LIM2         1
    RHS1      MYEQN        7
BOUNDS
 UP BND1      XONE         4
 LO BND1      YTWO        -1
 UP BND1      YTWO         1
ENDATA
`;

test('a small MPS file: rows, columns, RHS and bounds', () => {
  const m = readMps(TESTPROB);
  assert.equal(m.name, 'TESTPROB');
  assert.equal(m.sense, 'minimize');
  assert.equal(m.objectiveName, 'COST');
  assert.deepEqual(m.rowNames, ['LIM1', 'LIM2', 'MYEQN']);
  assert.deepEqual(m.colNames, ['XONE', 'YTWO', 'ZTHREE']);
  assert.deepEqual([...m.c], [1, 2, 3]);
  assert.deepEqual([...m.rowLo], [-Infinity, 1, 7]);
  assert.deepEqual([...m.rowUp], [4, Infinity, 7]);
  assert.deepEqual([...m.colLo], [0, -1, 0]);
  assert.deepEqual([...m.colUp], [4, 1, Infinity]);
  assert.equal(m.entries.value.length, 6);
});

test('a small MPS file solves: 16, at x = 0, y = -1, z = 6', () => {
  const prob = mpsToProblem(readMps(TESTPROB));
  assert.equal(prob.solveSync().status, 1);
  near(value(prob.objective), 16);
  const [x, y, z] = prob.variables();
  near(x!.varValue, 0);
  near(y!.varValue, -1);
  near(z!.varValue, 6);
});

test('fixed MPS reads by column, so names may hold spaces', () => {
  // Fixed MPS fields start at columns 2, 5, 15, 25, 40 and 50 (1-based).
  const line = (...f: string[]) => {
    const at = [1, 4, 14, 24, 39, 49];
    let out = '';
    f.forEach((v, i) => (out = out.padEnd(at[i]!) + v));
    return out;
  };
  const fixed = [
    'NAME          FIXED',
    'ROWS',
    line('N', 'COST'),
    line('L', 'LIM 1'),
    'COLUMNS',
    line('', 'X ONE', 'COST', '1.0', 'LIM 1', '1.0'),
    'RHS',
    line('', '', 'LIM 1', '4.0'),
    'BOUNDS',
    line('UP', '', 'X ONE', '3.0'),
    'ENDATA',
  ].join('\n');
  const m = readMps(fixed, { format: 'fixed' });
  assert.deepEqual(m.rowNames, ['LIM 1']);
  assert.deepEqual(m.colNames, ['X ONE']);
  assert.deepEqual([...m.rowUp], [4]);
  assert.deepEqual([...m.colUp], [3]);
});

test('RANGES on L, G and E rows', () => {
  const m = readMps(`NAME R
ROWS
 N obj
 L a
 G b
 E c
 E d
COLUMNS
 x obj 1 a 1
 x b 1 c 1
 x d 1
RHS
 rhs a 10 b 2
 rhs c 5 d 5
RANGES
 rng a 4 b 3
 rng c 2 d -2
ENDATA`);
  assert.deepEqual([...m.rowLo], [6, 2, 5, 3]);
  assert.deepEqual([...m.rowUp], [10, 5, 7, 5]);
});

test('every bound type, OBJSENSE, integer markers and the objective constant', () => {
  const m = readMps(`NAME B
OBJSENSE
    MAX
ROWS
 N obj
 L r
COLUMNS
 a obj 1 r 1
 b obj 1 r 1
 MARKER 'MARKER' 'INTORG'
 c obj 1 r 1
 MARKER 'MARKER' 'INTEND'
 d obj 1 r 1
 e obj 1 r 1
 f obj 1 r 1
 g obj 1 r 1
 h obj 1 r 1
RHS
 rhs r 10 obj -2.5
BOUNDS
 FR bnd a
 MI bnd b
 UP bnd b 5
 UP bnd d -3
 FX bnd e 2
 BV bnd f
 LI bnd g 1
 UI bnd g 9
 PL bnd h
ENDATA`);
  assert.equal(m.sense, 'maximize');
  assert.equal(m.offset, 2.5);
  // c, an integer column with no bounds, is 0 to 1; d's negative UP leaves its lower bound at 0 (both as HiGHS).
  assert.deepEqual([...m.colLo], [-Infinity, -Infinity, 0, 0, 2, 0, 1, 0]);
  assert.deepEqual([...m.colUp], [Infinity, 5, 1, -3, 2, 1, 9, Infinity]);
  assert.deepEqual([...m.integer], [0, 0, 1, 0, 0, 1, 1, 0]);
});

test('free MPS without set names, OBJSENSE on its header line, and comments', () => {
  const m = readMps(`* a comment
NAME tiny
OBJSENSE MAX
ROWS
 N obj
 L r
COLUMNS
 x obj 2 r 1
RHS
 r 3
BOUNDS
 UP x 2
ENDATA`);
  assert.equal(m.sense, 'maximize');
  assert.deepEqual([...m.rowUp], [3]);
  assert.deepEqual([...m.colUp], [2]);
  const prob = mpsToProblem(m);
  assert.equal(prob.solveSync().status, 1);
  near(value(prob.objective), 4);
});

test('a ranged row becomes two constraints, and solves', () => {
  const prob = mpsToProblem(readMps(`NAME R
ROWS
 N obj
 L cap
COLUMNS
 x obj -1 cap 1
RHS
 rhs cap 10
RANGES
 rng cap 4
ENDATA`));
  assert.deepEqual(prob.constraints().map((c) => c.name), ['cap', 'cap_range']);
  assert.equal(prob.solveSync().status, 1);
  near(value(prob.objective), -10);
});

test('broken files fail with LP_FORMAT, naming the line; unsupported parts with LP_UNSUPPORTED', () => {
  const code = (fn: () => unknown, c: string, line?: number) =>
    assert.throws(fn, (e: unknown) => e instanceof SmaltlpError && e.code === c && (line === undefined || e.message.includes(`line ${line}`)));
  code(() => readMps('NAME x\nROWS\n N obj\nCOLUMNS\n x obj 1\n'), 'LP_FORMAT');
  code(() => readMps('NAME x\nROWS\n L r\nCOLUMNS\nENDATA'), 'LP_FORMAT');
  code(() => readMps('NAME x\nROWS\n N obj\n Q r\nENDATA'), 'LP_FORMAT', 4);
  code(() => readMps('NAME x\nROWS\n N obj\nCOLUMNS\n x nope 1\nENDATA'), 'LP_FORMAT', 5);
  code(() => readMps('NAME x\nROWS\n N obj\nCOLUMNS\n x obj one\nENDATA'), 'LP_FORMAT', 5);
  code(() => readMps('NAME x\nROWS\n N obj\nCOLUMNS\n x obj 1\n y obj 1\n x obj 1\nENDATA'), 'LP_FORMAT', 7);
  code(() => readMps('NAME x\nROWS\n N obj\nCOLUMNS\n x obj 1\nBOUNDS\n SC bnd x 4\nENDATA'), 'LP_UNSUPPORTED', 7);
  code(() => readMps('NAME x\nROWS\n N obj\n L r\nCOLUMNS\n x obj 1 r 1\nRHS\n s1 r 1\n s2 r 2\nENDATA'), 'LP_UNSUPPORTED', 9);
  code(() => readMps('NAME x\nROWS\n N obj\nQUADOBJ\nENDATA'), 'LP_UNSUPPORTED', 4);
  code(() => readMps('NAME x\nROWS\n N obj\nCOLUMNS\nENDATA\n x obj 1'), 'LP_FORMAT', 6);
  code(() => readMps('NAME x\nROWS\n N obj\nCOLUMNS\n x obj 1\nENDATA', { format: 'other' as never }), 'LP_PARAM');
});

test('infinite values written as 1e30 read as infinite', () => {
  const m = readMps('NAME x\nROWS\n N obj\nCOLUMNS\n x obj 1\nBOUNDS\n UP bnd x 1e30\n LO bnd x -1e+30\nENDATA');
  assert.deepEqual([...m.colLo], [-Infinity]);
  assert.deepEqual([...m.colUp], [Infinity]);
});

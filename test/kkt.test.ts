/**
 * Random linear programs, each checked against the optimality conditions (KKT) rather than another solver: a result
 * is optimal exactly when it is primal feasible, its duals are dual feasible, complementary slackness holds, and
 * cᵀx equals the dual objective. The compare tests against HiGHS come in a later step.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linprogSync, type Bound } from '../src/index.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

interface Case {
  c: number[];
  AUb: number[][];
  bUb: number[];
  AEq: number[][];
  bEq: number[];
  bounds: Bound[];
}

/** A feasible problem built around a point x0 inside its bounds; every variable is bounded in its cost's direction. */
function randomCase(seed: number, m1: number, m2: number, n: number, density: number, boxRows = false): Case {
  const r = rng(seed);
  const pick = () => (r() < density ? Math.round((r() * 20 - 10) * 4) / 4 : 0);
  const bounds: Bound[] = [];
  const x0: number[] = [];
  const c: number[] = [];
  for (let j = 0; j < n; j++) {
    const kind = r();
    const lo = Math.round(r() * 10 - 5);
    const width = 1 + Math.round(r() * 10);
    if (kind < 0.6) {
      bounds.push([lo, lo + width]);
      c.push(Math.round(r() * 20 - 10));
    } else if (kind < 0.8) {
      bounds.push([lo, null]);
      c.push(Math.round(r() * 10));
    } else if (kind < 0.9) {
      bounds.push([null, lo + width]);
      c.push(-Math.round(r() * 10));
    } else {
      bounds.push([null, null]);
      c.push(0);
    }
    x0.push(lo + r() * width);
    // With boxRows, any cost sign: rows, not bounds, keep the variable from running off.
    if (boxRows) c[j] = Math.round(r() * 20 - 10);
  }
  const AUb: number[][] = [];
  const bUb: number[] = [];
  for (let i = 0; i < m1; i++) {
    const row = Array.from({ length: n }, pick);
    AUb.push(row);
    // Some rows tight at x0, so the optimum is often degenerate.
    bUb.push(row.reduce((s, a, j) => s + a * x0[j]!, 0) + (r() < 0.3 ? 0 : r() * 5));
  }
  if (boxRows) {
    for (let j = 0; j < n; j++) {
      const [l, u] = bounds[j]!;
      const e = Array.from({ length: n }, (_, k) => (k === j ? 1 : 0));
      if (u === null) {
        AUb.push(e);
        bUb.push(x0[j]! + 1 + r() * 5);
      }
      if (l === null) {
        AUb.push(e.map((v) => -v));
        bUb.push(-(x0[j]! - 1 - r() * 5));
      }
    }
  }
  const AEq: number[][] = [];
  const bEq: number[] = [];
  for (let i = 0; i < m2; i++) {
    const row = Array.from({ length: n }, pick);
    AEq.push(row);
    bEq.push(row.reduce((s, a, j) => s + a * x0[j]!, 0));
  }
  return { c, AUb, bUb, AEq, bEq, bounds };
}

/** Checks the optimality conditions, scaled to the problem's size. */
function checkKkt(k: Case, label: string): void {
  const n = k.c.length;
  const res = linprogSync(k.c, { AUb: k.AUb, bUb: k.bUb, AEq: k.AEq, bEq: k.bEq, bounds: k.bounds });
  assert.equal(res.status, 0, `${label}: ${res.message}`);
  const x = res.x!;
  const tol = 1e-6;
  const lo = k.bounds.map(([l]) => (l === null ? -Infinity : l));
  const up = k.bounds.map(([, u]) => (u === null ? Infinity : u));
  // Primal feasibility.
  for (let j = 0; j < n; j++) assert.ok(x[j]! >= lo[j]! - tol && x[j]! <= up[j]! + tol, `${label}: x[${j}] = ${x[j]} outside [${lo[j]}, ${up[j]}]`);
  k.AUb.forEach((row, i) => {
    const ax = row.reduce((s, a, j) => s + a * x[j]!, 0);
    assert.ok(ax <= k.bUb[i]! + tol * (1 + Math.abs(k.bUb[i]!)), `${label}: inequality ${i}: ${ax} > ${k.bUb[i]}`);
  });
  k.AEq.forEach((row, i) => {
    const ax = row.reduce((s, a, j) => s + a * x[j]!, 0);
    assert.ok(Math.abs(ax - k.bEq[i]!) <= tol * (1 + Math.abs(k.bEq[i]!)), `${label}: equality ${i}: ${ax} ≠ ${k.bEq[i]}`);
  });
  // Dual feasibility: marginals with the right signs, and only on finite bounds.
  const yUb = res.ineqlin!.marginals;
  const yEq = res.eqlin!.marginals;
  const zLo = res.lower!.marginals;
  const zUp = res.upper!.marginals;
  yUb.forEach((y, i) => assert.ok(y <= tol, `${label}: inequality ${i}'s marginal ${y} > 0`));
  for (let j = 0; j < n; j++) {
    assert.ok(zLo[j]! >= -tol && (zLo[j] === 0 || lo[j]! > -Infinity), `${label}: lower marginal ${j} = ${zLo[j]}`);
    assert.ok(zUp[j]! <= tol && (zUp[j] === 0 || up[j]! < Infinity), `${label}: upper marginal ${j} = ${zUp[j]}`);
  }
  // Stationarity: c = AUbᵀ yUb + AEqᵀ yEq + zLo + zUp.
  const scale = 1 + Math.max(...k.c.map(Math.abs));
  for (let j = 0; j < n; j++) {
    let s = k.c[j]! - zLo[j]! - zUp[j]!;
    k.AUb.forEach((row, i) => (s -= row[j]! * yUb[i]!));
    k.AEq.forEach((row, i) => (s -= row[j]! * yEq[i]!));
    assert.ok(Math.abs(s) <= tol * scale, `${label}: stationarity for x[${j}] is off by ${s}`);
  }
  // Complementary slackness and no duality gap.
  let dualObj = 0;
  k.bUb.forEach((b, i) => {
    assert.ok(Math.abs(yUb[i]! * res.slack![i]!) <= tol * scale * (1 + Math.abs(b)), `${label}: inequality ${i} not complementary`);
    dualObj += b * yUb[i]!;
  });
  k.bEq.forEach((b, i) => (dualObj += b * yEq[i]!));
  for (let j = 0; j < n; j++) {
    if (zLo[j] !== 0) dualObj += lo[j]! * zLo[j]!;
    if (zUp[j] !== 0) dualObj += up[j]! * zUp[j]!;
    assert.ok(Math.abs(zLo[j]! * (x[j]! - lo[j]!)) <= tol * scale * (1 + Math.abs(lo[j]!)) || zLo[j] === 0, `${label}: lower bound ${j} not complementary`);
    assert.ok(Math.abs(zUp[j]! * (up[j]! - x[j]!)) <= tol * scale * (1 + Math.abs(up[j]!)) || zUp[j] === 0, `${label}: upper bound ${j} not complementary`);
  }
  assert.ok(Math.abs(res.fun! - dualObj) <= tol * scale * (1 + Math.abs(res.fun!)), `${label}: duality gap ${res.fun! - dualObj}`);
}

test('random small problems meet the optimality conditions', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed * 7919);
    const n = 1 + Math.floor(r() * 12);
    checkKkt(randomCase(seed, Math.floor(r() * 10), Math.floor(r() * 4), n, 0.6), `seed ${seed}`);
  }
});

test('random larger, sparser problems meet the optimality conditions', () => {
  for (let seed = 1; seed <= 12; seed++) checkKkt(randomCase(1000 + seed, 60, 15, 90, 0.08), `large seed ${seed}`);
});

test('costs toward infinite bounds, held by rows: artificial bounds at work', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const r = rng(seed * 104729);
    const n = 1 + Math.floor(r() * 10);
    checkKkt(randomCase(5000 + seed, Math.floor(r() * 6), Math.floor(r() * 3), n, 0.6, true), `boxed seed ${seed}`);
  }
});

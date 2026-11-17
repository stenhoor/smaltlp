import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BasisFactor } from '../src/core/basis.ts';

/** A seeded generator, so a failure repeats. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

function matVec(B: Float64Array, m: number, x: Float64Array): Float64Array {
  const y = new Float64Array(m);
  for (let r = 0; r < m; r++) for (let i = 0; i < m; i++) y[r]! += B[r * m + i]! * x[i]!;
  return y;
}
function matTVec(B: Float64Array, m: number, y: Float64Array): Float64Array {
  const x = new Float64Array(m);
  for (let i = 0; i < m; i++) for (let r = 0; r < m; r++) x[i]! += B[r * m + i]! * y[r]!;
  return x;
}
function close(a: ArrayLike<number>, b: ArrayLike<number>, tol: number): void {
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i]! - b[i]!) <= tol * (1 + Math.abs(b[i]!)), `entry ${i}: ${a[i]} vs ${b[i]}`);
}

test('ftran and btran solve B x = a and Bᵀ y = e, on odd sizes', () => {
  const r = rng(7);
  for (const m of [1, 2, 3, 7, 16, 33]) {
    const B = new Float64Array(m * m).map(() => r());
    const f = new BasisFactor(m);
    assert.ok(f.factor(B));
    const a = new Float64Array(m).map(() => r());
    close(matVec(B, m, f.ftran(a.slice())), a, 1e-10);
    close(matTVec(B, m, f.btran(a.slice())), a, 1e-10);
  }
});

test('product-form updates give the new basis', () => {
  const r = rng(11);
  const m = 9;
  const B = new Float64Array(m * m).map(() => r());
  const f = new BasisFactor(m);
  assert.ok(f.factor(B));
  for (let k = 0; k < 12; k++) {
    // Replace column `row` of B with a new column q.
    const row = (k * 5) % m;
    const q = new Float64Array(m).map(() => r());
    const alpha = f.ftran(q.slice());
    f.update(row, alpha);
    for (let i = 0; i < m; i++) B[i * m + row] = q[i]!;
    const a = new Float64Array(m).map(() => r());
    close(matVec(B, m, f.ftran(a.slice())), a, 1e-8);
    close(matTVec(B, m, f.btran(a.slice())), a, 1e-8);
  }
  assert.equal(f.updates, 12);
});

test('a singular basis is refused', () => {
  const f = new BasisFactor(3);
  assert.equal(f.factor(new Float64Array([1, 2, 3, 2, 4, 6, 0, 1, 1])), false);
  assert.equal(f.factor(new Float64Array(9)), false);
});

test('an empty basis factors', () => {
  const f = new BasisFactor(0);
  assert.ok(f.factor(new Float64Array(0)));
  assert.equal(f.ftran(new Float64Array(0)).length, 0);
});

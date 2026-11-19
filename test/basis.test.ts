import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BasisFactor, type SparseColumn } from '../src/core/basis.ts';

/** A seeded generator, so a failure repeats. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

/** The columns of a dense row-major m × m matrix, sparse. */
function columnsOf(B: Float64Array, m: number): SparseColumn[] {
  return Array.from({ length: m }, (_, j) => {
    const index: number[] = [];
    const value: number[] = [];
    for (let r = 0; r < m; r++) if (B[r * m + j] !== 0) (index.push(r), value.push(B[r * m + j]!));
    return { index, value };
  });
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

/** A sparse random matrix, made non-singular by a strong diagonal under a random permutation of its columns. */
function sparseMatrix(m: number, density: number, seed: number): Float64Array {
  const r = rng(seed);
  const B = new Float64Array(m * m);
  const perm = Array.from({ length: m }, (_, i) => i).sort(() => r());
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) if (Math.abs(r()) < density) B[i * m + j] = r();
    B[i * m + perm[i]!] = 3 + r();
  }
  return B;
}

test('ftran and btran solve B x = a and Bᵀ y = e, dense, on odd sizes', () => {
  const r = rng(7);
  for (const m of [1, 2, 3, 7, 16, 33]) {
    const B = new Float64Array(m * m).map(() => r());
    const f = new BasisFactor(m);
    assert.ok(f.factor(columnsOf(B, m)));
    const a = new Float64Array(m).map(() => r());
    close(matVec(B, m, f.ftran(a.slice())), a, 1e-10);
    close(matTVec(B, m, f.btran(a.slice())), a, 1e-10);
  }
});

test('ftran and btran on sparse matrices, with little fill', () => {
  for (const [m, seed] of [[10, 1], [50, 2], [120, 3], [200, 4]] as const) {
    const B = sparseMatrix(m, 0.03, seed);
    const f = new BasisFactor(m);
    assert.ok(f.factor(columnsOf(B, m)));
    const r = rng(seed + 100);
    const a = new Float64Array(m).map(() => r());
    close(matVec(B, m, f.ftran(a.slice())), a, 1e-9);
    close(matTVec(B, m, f.btran(a.slice())), a, 1e-9);
    // Markowitz pivoting keeps L and U far below dense: m² entries.
    const nnz = B.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
    assert.ok(f.entries < 6 * nnz, `${m}: ${f.entries} entries in L and U for ${nnz} in B`);
  }
});

test('a slack basis, −I, and a permuted identity factor exactly', () => {
  const m = 6;
  const f = new BasisFactor(m);
  assert.ok(f.factor(Array.from({ length: m }, (_, j) => ({ index: [j], value: [-1] }))));
  assert.deepEqual([...f.ftran(Float64Array.from([1, 2, 3, 4, 5, 6]))], [-1, -2, -3, -4, -5, -6]);
  const perm = [3, 0, 5, 1, 4, 2];
  assert.ok(f.factor(perm.map((i) => ({ index: [i], value: [2] }))));
  // B e_j = 2 e_perm[j], so B x = a has x_j = a[perm[j]] / 2.
  assert.deepEqual([...f.ftran(Float64Array.from([2, 4, 6, 8, 10, 12]))], perm.map((i) => i + 1));
});

test('product-form updates give the new basis', () => {
  const r = rng(11);
  const m = 9;
  const B = sparseMatrix(m, 0.3, 5);
  const f = new BasisFactor(m);
  assert.ok(f.factor(columnsOf(B, m)));
  for (let k = 0; k < 12; k++) {
    // Replace column `pos` of B with a new column q.
    const pos = (k * 5) % m;
    const q = new Float64Array(m).map(() => r());
    q[pos]! += 4;
    const alpha = f.ftran(q.slice());
    f.update(pos, alpha);
    for (let i = 0; i < m; i++) B[i * m + pos] = q[i]!;
    const a = new Float64Array(m).map(() => r());
    close(matVec(B, m, f.ftran(a.slice())), a, 1e-8);
    close(matTVec(B, m, f.btran(a.slice())), a, 1e-8);
  }
  assert.equal(f.updates, 12);
});

test('a singular basis is refused', () => {
  const f = new BasisFactor(3);
  assert.equal(f.factor(columnsOf(new Float64Array([1, 2, 3, 2, 4, 6, 0, 1, 1]), 3)), false);
  assert.equal(f.factor(columnsOf(new Float64Array(9), 3)), false);
  // Two columns the same.
  assert.equal(f.factor([{ index: [0, 1], value: [1, 2] }, { index: [0, 1], value: [1, 2] }, { index: [2], value: [1] }]), false);
});

test('an empty basis factors', () => {
  const f = new BasisFactor(0);
  assert.ok(f.factor([]));
  assert.equal(f.ftran(new Float64Array(0)).length, 0);
});

test('a clone goes on independently: updates to it leave the original as it was', () => {
  const r = rng(23);
  const m = 8;
  const B = sparseMatrix(m, 0.3, 9);
  const f = new BasisFactor(m);
  assert.ok(f.factor(columnsOf(B, m)));
  const g = f.clone();
  // Change column 3 in the clone only.
  const q = new Float64Array(m).map(() => r());
  q[3]! += 4;
  g.update(3, g.ftran(q.slice()));
  const B2 = B.slice();
  for (let i = 0; i < m; i++) B2[i * m + 3] = q[i]!;
  const a = new Float64Array(m).map(() => r());
  close(matVec(B, m, f.ftran(a.slice())), a, 1e-9);
  close(matVec(B2, m, g.ftran(a.slice())), a, 1e-9);
  close(matTVec(B2, m, g.btran(a.slice())), a, 1e-9);
  assert.equal(f.updates, 0);
  assert.equal(g.updates, 1);
});

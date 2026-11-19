/**
 * Presolve and postsolve (smaltworks ADR 0039, section 4): simple reductions that make a linear program smaller before
 * the dual simplex sees it, and the steps that rebuild the original problem's solution and duals afterwards.
 *
 * The reductions, repeated until none applies:
 * - **An empty row** (no entries) is dropped; its range must hold 0, or the problem is infeasible. Its dual is 0.
 * - **A fixed column** (lower bound = upper bound) is substituted out: each row it is in has its range shifted by the
 *   column's value times its entry.
 * - **A singleton row** (one entry, `a · x_j`) becomes a bound on `x_j` and is dropped. Postsolve gives the row the dual
 *   it would have had: where `x_j` ends at a bound that came from the row, the row's dual is `d_j / a` and the bound's
 *   reduced cost is 0.
 *
 * Postsolve restores every column's value, gives every row its dual (the reduced problem's for the rows that stayed),
 * and recomputes every column's reduced cost from the original problem, d = c − Aᵀy, so the result is the original
 * problem's, duals included. It gives a basis for the original problem too, to start a later solve from: the reduced
 * basis, a dropped row's column where the row is binding (its logical otherwise), and an empty row's logical. Written from the published descriptions (Andersen and Andersen, Mathematical Programming,
 * 1995; Maros, Computational Techniques of the Simplex Method, 2003), not from any solver's code.
 * @module
 */
import { fromTriplets, multiply, multiplyTransposed } from '../core/sparse.ts';
import { dualSimplex, type Lp, type SimplexOptions, type SimplexResult } from './simplex.ts';

/** How far a bound may be crossed by rounding before a problem counts as infeasible. */
const FEAS_TOL = 1e-9;

/** Solves the problem with presolve (by default) or without, and returns the original problem's result. */
export function solve(lp: Lp, opts: SimplexOptions & { presolve?: boolean }): SimplexResult {
  if (opts.presolve === false) return dualSimplex(lp, opts);
  return presolveAndSolve(lp, opts);
}

function presolveAndSolve(lp: Lp, opts: SimplexOptions): SimplexResult {
  const { A, c } = lp;
  const m = A.rows;
  const n = A.cols;
  const colLo = lp.colLo.slice();
  const colUp = lp.colUp.slice();
  const rowLo = lp.rowLo.slice();
  const rowUp = lp.rowUp.slice();

  // The matrix by rows too, for row counts and singleton rows.
  const rowEntries: { j: number; a: number }[][] = Array.from({ length: m }, () => []);
  for (let j = 0; j < n; j++) for (let p = A.start[j]!; p < A.start[j + 1]!; p++) rowEntries[A.index[p]!]!.push({ j, a: A.value[p]! });

  const rowGone = new Uint8Array(m);
  const colGone = new Uint8Array(n);
  const rowCount = Int32Array.from(rowEntries, (e) => e.length);
  /** The singleton rows dropped, in order: each row, its column and entry, and the bounds it implied on the column. */
  const removed: { i: number; j: number; a: number; lo: number; up: number }[] = [];
  const fixedValue = new Float64Array(n);

  const infeasible = (): SimplexResult => ({ status: 2, nit: 0, x: new Float64Array(n + m), d: new Float64Array(n + m), at: new Int8Array(n + m), basis: null });

  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < m; i++) {
      if (rowGone[i]) continue;
      if (rowCount[i] === 0) {
        if (rowLo[i]! > FEAS_TOL || rowUp[i]! < -FEAS_TOL) return infeasible();
        rowGone[i] = 1;
        changed = true;
      } else if (rowCount[i] === 1) {
        const { j, a } = rowEntries[i]!.find((e) => !colGone[e.j])!;
        // a · x_j in [rowLo, rowUp] is x_j in [lo, up], flipped when a < 0.
        const lo = a > 0 ? rowLo[i]! / a : rowUp[i]! / a;
        const up = a > 0 ? rowUp[i]! / a : rowLo[i]! / a;
        if (lo > colLo[j]!) colLo[j] = lo;
        if (up < colUp[j]!) colUp[j] = up;
        if (colLo[j]! > colUp[j]! + FEAS_TOL * (1 + Math.abs(colUp[j]!))) return infeasible();
        if (colLo[j]! > colUp[j]!) colUp[j] = colLo[j]!;
        // The bounds this row implies on its own, so postsolve credits it only with a bound it set.
        removed.push({ i, j, a, lo, up });
        rowGone[i] = 1;
        changed = true;
      }
    }
    for (let j = 0; j < n; j++) {
      if (colGone[j] || colLo[j] !== colUp[j]) continue;
      // A fixed column: its value moves into the rows' ranges.
      const v = colLo[j]!;
      fixedValue[j] = v;
      colGone[j] = 1;
      for (let p = A.start[j]!; p < A.start[j + 1]!; p++) {
        const i = A.index[p]!;
        if (rowGone[i]) continue;
        rowLo[i]! -= A.value[p]! * v;
        rowUp[i]! -= A.value[p]! * v;
        rowCount[i]!--;
      }
      changed = true;
    }
  }

  // The reduced problem.
  const keepRows: number[] = [];
  const keepCols: number[] = [];
  const newRow = new Int32Array(m).fill(-1);
  for (let i = 0; i < m; i++) if (!rowGone[i]) (newRow[i] = keepRows.length), keepRows.push(i);
  for (let j = 0; j < n; j++) if (!colGone[j]) keepCols.push(j);
  const ii: number[] = [];
  const jj: number[] = [];
  const vv: number[] = [];
  keepCols.forEach((j, k) => {
    for (let p = A.start[j]!; p < A.start[j + 1]!; p++) {
      const r = newRow[A.index[p]!]!;
      if (r < 0) continue;
      ii.push(r);
      jj.push(k);
      vv.push(A.value[p]!);
    }
  });
  const reduced: Lp = {
    A: fromTriplets(keepRows.length, keepCols.length, ii, jj, vv),
    c: Float64Array.from(keepCols, (j) => c[j]!),
    colLo: Float64Array.from(keepCols, (j) => colLo[j]!),
    colUp: Float64Array.from(keepCols, (j) => colUp[j]!),
    rowLo: Float64Array.from(keepRows, (i) => rowLo[i]!),
    rowUp: Float64Array.from(keepRows, (i) => rowUp[i]!),
  };
  const res = dualSimplex(reduced, opts);
  if (res.status !== 0) return { ...res, x: new Float64Array(n + m), d: new Float64Array(n + m), at: new Int8Array(n + m), basis: null };

  // Postsolve: the columns' values, then every row's dual, then every column's reduced cost from the original problem.
  const nr = keepCols.length;
  const x = new Float64Array(n + m);
  for (let j = 0; j < n; j++) x[j] = fixedValue[j]!;
  keepCols.forEach((j, k) => (x[j] = res.x[k]!));
  const y = new Float64Array(m);
  keepRows.forEach((i, r) => (y[i] = res.d[nr + r]!));
  // Every column's reduced cost in the original problem, d = c − Aᵀy, kept up to date as removed rows get duals.
  const d = new Float64Array(n + m);
  const aty = multiplyTransposed(A, y);
  for (let j = 0; j < n; j++) d[j] = c[j]! - aty[j]!;
  const rowsByIndex = rowEntries;
  // The basis: the reduced problem's, in the original's numbering, then one variable for each row dropped.
  const isBasic = new Uint8Array(n + m);
  for (const b of res.basis!) isBasic[b < nr ? keepCols[b]! : n + keepRows[b - nr]!] = 1;
  const bindingRow = new Uint8Array(m);
  // The dropped singleton rows, last dropped first: each row dropped later is settled before the rows it depended on.
  // A row gets a dual where its column ends at a bound it implied, tighter than the column's own, on the side the
  // column's reduced cost presses on: then the row is binding, and its dual takes the reduced cost, d_j / a.
  for (let t = removed.length - 1; t >= 0; t--) {
    const { i, j, a, lo, up } = removed[t]!;
    const dj = d[j]!;
    const binding = (dj > 0 && x[j] === lo && lo > lp.colLo[j]!) || (dj < 0 && x[j] === up && up < lp.colUp[j]!);
    if (!binding) continue;
    const dy = dj / a;
    bindingRow[i] = 1;
    y[i]! += dy;
    for (const { j: k, a: aik } of rowsByIndex[i]!) d[k]! -= aik * dy;
  }
  const ax = multiply(A, x.subarray(0, n));
  for (let i = 0; i < m; i++) {
    x[n + i] = ax[i]!;
    d[n + i] = y[i]!;
  }
  // A binding row's column becomes basic, where it isn't already, and the row's logical leaves; every other dropped
  // row's logical is basic. Each column has at most one binding row: crediting one sets its reduced cost to 0.
  for (let i = 0; i < m; i++) {
    if (!rowGone[i]) continue;
    const entry = bindingRow[i] ? removed.find((r) => r.i === i)! : null;
    if (entry && !isBasic[entry.j]) isBasic[entry.j] = 1;
    else isBasic[n + i] = 1;
  }
  const basis = new Int32Array(m);
  for (let k = 0, j = 0; j < n + m; j++) if (isBasic[j]) basis[k++] = j;
  // Which bound each original column ends at, for the marginals.
  const at = new Int8Array(n + m);
  for (let j = 0; j < n; j++) {
    const atLo = x[j] === lp.colLo[j];
    const atUp = x[j] === lp.colUp[j];
    if (atLo && atUp) at[j] = d[j]! >= 0 ? -1 : 1;
    else if (atLo) at[j] = -1;
    else if (atUp) at[j] = 1;
  }
  return { status: 0, nit: res.nit, x, d, at, basis };
}


/**
 * Sparse matrices in compressed sparse column form (CSC): the constraint matrix as the solver reads it, a column at
 * a time.
 * @module
 */
import { fail } from './errors.ts';

/** A matrix in compressed sparse column form. Column j's entries are at `start[j]` up to `start[j + 1]`. */
export interface Csc {
  rows: number;
  cols: number;
  /** Where each column's entries begin in `index` and `value`; `cols + 1` long. */
  start: Int32Array;
  /** The row of each entry. */
  index: Int32Array;
  value: Float64Array;
}

/** A sparse matrix given as triplets: entry k is `v[k]` at row `i[k]`, column `j[k]`. Repeated positions add up. */
export interface SparseInput {
  rows: number;
  cols: number;
  i: ArrayLike<number>;
  j: ArrayLike<number>;
  v: ArrayLike<number>;
}

/** A matrix: rows of numbers, or {@link SparseInput} triplets. */
export type MatrixInput = readonly (ArrayLike<number>)[] | SparseInput;

/** Whether the input is triplets rather than rows. */
function isSparse(a: MatrixInput): a is SparseInput {
  return !Array.isArray(a) && typeof a === 'object' && a !== null && 'i' in a && 'j' in a && 'v' in a;
}

/** The number of rows and columns of a matrix input, checking that every row has the same length. */
export function shapeOf(a: MatrixInput, name: string): { rows: number; cols: number } {
  if (isSparse(a)) {
    if (!Number.isInteger(a.rows) || !Number.isInteger(a.cols) || a.rows < 0 || a.cols < 0) {
      fail('LP_SHAPE', `${name}: rows and cols must be whole numbers, 0 or more`);
    }
    return { rows: a.rows, cols: a.cols };
  }
  if (!Array.isArray(a)) fail('LP_PARAM', `${name} must be an array of rows or { rows, cols, i, j, v }`);
  const rows = a.length;
  const cols = rows ? a[0]!.length : 0;
  for (let r = 0; r < rows; r++) {
    const row = a[r];
    if (row === null || typeof row !== 'object' || typeof row.length !== 'number') fail('LP_PARAM', `${name}: row ${r} isn't an array`);
    if (row.length !== cols) fail('LP_SHAPE', `${name}: row ${r} has ${row.length} entries, row 0 has ${cols}`);
  }
  return { rows, cols };
}

/**
 * Stacks matrix inputs on top of each other (all with `cols` columns) into one CSC matrix, dropping zeros. NaN and
 * infinite entries fail with LP_VALUE.
 */
export function stackCsc(parts: readonly { a: MatrixInput; name: string }[], cols: number): Csc {
  const ii: number[] = [];
  const jj: number[] = [];
  const vv: number[] = [];
  let offset = 0;
  for (const { a, name } of parts) {
    const { rows, cols: c } = shapeOf(a, name);
    if (c !== cols && rows > 0) fail('LP_SHAPE', `${name} has ${c} columns; c has ${cols}`);
    const push = (r: number, col: number, v: number) => {
      if (!Number.isFinite(v)) fail('LP_VALUE', `${name}[${r}][${col}] is ${v}; entries must be finite`);
      if (v !== 0) {
        ii.push(offset + r);
        jj.push(col);
        vv.push(v);
      }
    };
    if (isSparse(a)) {
      const n = a.v.length;
      if (a.i.length !== n || a.j.length !== n) fail('LP_SHAPE', `${name}: i, j and v must have the same length`);
      for (let k = 0; k < n; k++) {
        const r = a.i[k]!;
        const col = a.j[k]!;
        if (!Number.isInteger(r) || r < 0 || r >= rows) fail('LP_SHAPE', `${name}: entry ${k} has row ${r}, outside 0 to ${rows - 1}`);
        if (!Number.isInteger(col) || col < 0 || col >= cols) fail('LP_SHAPE', `${name}: entry ${k} has column ${col}, outside 0 to ${cols - 1}`);
        push(r, col, a.v[k]!);
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const row = a[r]!;
        for (let col = 0; col < cols; col++) push(r, col, row[col]!);
      }
    }
    offset += rows;
  }
  return fromTriplets(offset, cols, ii, jj, vv);
}

/** A CSC matrix from triplets; entries at the same position are added, and sums of exactly 0 dropped. */
export function fromTriplets(rows: number, cols: number, ii: ArrayLike<number>, jj: ArrayLike<number>, vv: ArrayLike<number>): Csc {
  const count = new Int32Array(cols + 1);
  for (let k = 0; k < jj.length; k++) count[jj[k]! + 1]!++;
  for (let j = 0; j < cols; j++) count[j + 1]! += count[j]!;
  const next = count.slice(0, cols);
  const index = new Int32Array(jj.length);
  const value = new Float64Array(jj.length);
  for (let k = 0; k < jj.length; k++) {
    const p = next[jj[k]!]!++;
    index[p] = ii[k]!;
    value[p] = vv[k]!;
  }
  // Sort each column by row and merge repeats.
  const start = new Int32Array(cols + 1);
  let w = 0;
  for (let j = 0; j < cols; j++) {
    const from = count[j]!;
    const to = count[j + 1]!;
    const order = Array.from({ length: to - from }, (_, k) => from + k).sort((a, b) => index[a]! - index[b]!);
    const rowsJ = order.map((p) => index[p]!);
    const valsJ = order.map((p) => value[p]!);
    start[j] = w;
    for (let k = 0; k < rowsJ.length; k++) {
      if (w > start[j]! && index[w - 1] === rowsJ[k]) value[w - 1]! += valsJ[k]!;
      else {
        index[w] = rowsJ[k]!;
        value[w] = valsJ[k]!;
        w++;
      }
    }
    // Drop entries that summed to exactly 0.
    let keep = start[j]!;
    for (let p = start[j]!; p < w; p++) {
      if (value[p] !== 0) {
        index[keep] = index[p]!;
        value[keep] = value[p]!;
        keep++;
      }
    }
    w = keep;
  }
  start[cols] = w;
  return { rows, cols, start, index: index.slice(0, w), value: value.slice(0, w) };
}

/** y = A x, for a CSC matrix A. */
export function multiply(A: Csc, x: ArrayLike<number>): Float64Array {
  const y = new Float64Array(A.rows);
  for (let j = 0; j < A.cols; j++) {
    const xj = x[j]!;
    if (xj === 0) continue;
    for (let p = A.start[j]!; p < A.start[j + 1]!; p++) y[A.index[p]!]! += A.value[p]! * xj;
  }
  return y;
}

/** x = Aᵀ y, for a CSC matrix A. */
export function multiplyTransposed(A: Csc, y: ArrayLike<number>): Float64Array {
  const x = new Float64Array(A.cols);
  for (let j = 0; j < A.cols; j++) {
    let s = 0;
    for (let p = A.start[j]!; p < A.start[j + 1]!; p++) s += A.value[p]! * y[A.index[p]!]!;
    x[j] = s;
  }
  return x;
}

/**
 * The basis factorization the simplex method solves with: a sparse LU of the basis matrix B, found by Gaussian
 * elimination with Markowitz pivoting and a threshold test, and the product form for the bases that follow, one sparse
 * eta column per change of basis, until the next refactorization (smaltworks ADR 0039, section 4).
 *
 * Elimination step k picks a pivot (row p_k, column q_k) from the active submatrix: among the few columns and rows with
 * the fewest entries, the entry with the smallest Markowitz count (r − 1)(c − 1) whose size is at least THRESHOLD times
 * its column's largest, which bounds growth. It subtracts multiples of row p_k from the other rows with an entry in
 * column q_k (L, the multipliers) and keeps row p_k (U). FTRAN and BTRAN then run through L and U in step order, with
 * no dense matrix anywhere.
 *
 * Written from the published method (Markowitz, 1957; Duff, Erisman and Reid, Direct Methods for Sparse Matrices; Suhl
 * and Suhl, ORSA Journal on Computing, 1990), not from any solver's code.
 * @module
 */

/** A pivot below this fraction of its column's largest entry isn't taken: it would let rounding grow. */
export const THRESHOLD = 0.1;
/** A column whose largest entry is below this is treated as zero: the basis is singular to working precision. */
export const SINGULAR = 1e-11;
/** How many of the shortest columns and rows the pivot search looks at, each step. */
const SEARCH = 4;

/** One column of B, sparse: entry k is `value[k]` at row `index[k]`. */
export interface SparseColumn {
  index: ArrayLike<number>;
  value: ArrayLike<number>;
}

/** The factorization of a basis matrix B (m × m) and the changes of basis since. */
export class BasisFactor {
  readonly m: number;
  /** Step k's pivot row and column. */
  private pivotRow = new Int32Array(0);
  private pivotCol = new Int32Array(0);
  /** Step k's multipliers: rows Lrow[Lstart[k] … Lstart[k+1]) each lost Lval times row p_k. */
  private Lstart = new Int32Array(1);
  private Lrow = new Int32Array(0);
  private Lval = new Float64Array(0);
  /** Step k's U row (row p_k as it was when pivoted): its pivot, then its other entries' columns and values. */
  private Upivot = new Float64Array(0);
  private Ustart = new Int32Array(1);
  private Ucol = new Int32Array(0);
  private Uval = new Float64Array(0);
  /** The product form: for each change of basis, the position it replaced and the entering column's nonzeros. */
  private etaPos: number[] = [];
  private etaPivot: number[] = [];
  private etaIndex: Int32Array[] = [];
  private etaValue: Float64Array[] = [];
  /** Work space for ftran and btran, kept between calls. */
  private readonly work: Float64Array;
  private readonly work2: Float64Array;

  constructor(m: number) {
    this.m = m;
    this.work = new Float64Array(m);
    this.work2 = new Float64Array(m);
  }

  /** The number of changes of basis since the last factorization. */
  get updates(): number {
    return this.etaPos.length;
  }

  /** The number of entries in L and U: a measure of fill-in. */
  get entries(): number {
    return this.Lrow.length + this.Ucol.length + this.m;
  }

  /**
   * Factors B, given as its m columns. Returns false where B is singular to working precision, and leaves the previous
   * factorization unusable.
   */
  factor(columns: readonly SparseColumn[]): boolean {
    const m = this.m;
    this.etaPos = [];
    this.etaPivot = [];
    this.etaIndex = [];
    this.etaValue = [];
    // The active submatrix, by rows (column → value) and by columns (the rows with an entry).
    const rows: Map<number, number>[] = Array.from({ length: m }, () => new Map());
    const cols: Set<number>[] = Array.from({ length: m }, () => new Set());
    for (let j = 0; j < m; j++) {
      const c = columns[j]!;
      for (let k = 0; k < c.index.length; k++) {
        const v = c.value[k]!;
        if (v === 0) continue;
        const i = c.index[k]!;
        rows[i]!.set(j, (rows[i]!.get(j) ?? 0) + v);
        cols[j]!.add(i);
      }
    }
    const rowDone = new Uint8Array(m);
    const colDone = new Uint8Array(m);
    const pivotRow = new Int32Array(m);
    const pivotCol = new Int32Array(m);
    const Lstart = [0];
    const Lrow: number[] = [];
    const Lval: number[] = [];
    const Upivot = new Float64Array(m);
    const Ustart = [0];
    const Ucol: number[] = [];
    const Uval: number[] = [];

    const colMax = (j: number): number => {
      let big = 0;
      for (const i of cols[j]!) big = Math.max(big, Math.abs(rows[i]!.get(j)!));
      return big;
    };

    for (let k = 0; k < m; k++) {
      // The SEARCH shortest active columns and rows.
      const shortCols = shortest(m, colDone, (j) => cols[j]!.size);
      const shortRows = shortest(m, rowDone, (i) => rows[i]!.size);
      if (shortCols.length === 0 || cols[shortCols[0]!]!.size === 0) return false;
      let p = -1;
      let q = -1;
      let best = Infinity;
      let bestSize = 0;
      const consider = (i: number, j: number, a: number, cmax: number) => {
        if (Math.abs(a) < THRESHOLD * cmax) return;
        const cost = (rows[i]!.size - 1) * (cols[j]!.size - 1);
        if (cost < best || (cost === best && Math.abs(a) > bestSize)) {
          best = cost;
          bestSize = Math.abs(a);
          p = i;
          q = j;
        }
      };
      for (const j of shortCols) {
        const cmax = colMax(j);
        if (cmax < SINGULAR) return false;
        for (const i of cols[j]!) consider(i, j, rows[i]!.get(j)!, cmax);
        if (best === 0) break;
      }
      if (best !== 0) {
        for (const i of shortRows) {
          for (const [j, a] of rows[i]!) consider(i, j, a, colMax(j));
          if (best === 0) break;
        }
      }
      if (p < 0) return false;

      // Eliminate: every other active row with an entry in column q loses l × row p.
      const rowP = rows[p]!;
      const d = rowP.get(q)!;
      pivotRow[k] = p;
      pivotCol[k] = q;
      Upivot[k] = d;
      for (const i of cols[q]!) {
        if (i === p) continue;
        const rowI = rows[i]!;
        const l = rowI.get(q)! / d;
        rowI.delete(q);
        Lrow.push(i);
        Lval.push(l);
        for (const [j, u] of rowP) {
          if (j === q) continue;
          const v = (rowI.get(j) ?? 0) - l * u;
          if (v === 0) {
            rowI.delete(j);
            cols[j]!.delete(i);
          } else {
            rowI.set(j, v);
            cols[j]!.add(i);
          }
        }
      }
      Lstart.push(Lrow.length);
      // Row p becomes step k's U row, and leaves the active submatrix with column q.
      for (const [j, u] of rowP) {
        cols[j]!.delete(p);
        if (j === q) continue;
        Ucol.push(j);
        Uval.push(u);
      }
      Ustart.push(Ucol.length);
      cols[q]!.clear();
      rowDone[p] = 1;
      colDone[q] = 1;
    }

    this.pivotRow = pivotRow;
    this.pivotCol = pivotCol;
    this.Lstart = Int32Array.from(Lstart);
    this.Lrow = Int32Array.from(Lrow);
    this.Lval = Float64Array.from(Lval);
    this.Upivot = Upivot;
    this.Ustart = Int32Array.from(Ustart);
    this.Ucol = Int32Array.from(Ucol);
    this.Uval = Float64Array.from(Uval);
    return true;
  }

  /** Solves B x = a (a by row, x by position), overwriting and returning `a` (forward transformation, FTRAN). */
  ftran(a: Float64Array): Float64Array {
    const m = this.m;
    const { pivotRow, pivotCol, Lstart, Lrow, Lval, Upivot, Ustart, Ucol, Uval } = this;
    // L: the elimination applied to the right-hand side.
    for (let k = 0; k < m; k++) {
      const v = a[pivotRow[k]!]!;
      if (v === 0) continue;
      for (let e = Lstart[k]!; e < Lstart[k + 1]!; e++) a[Lrow[e]!]! -= Lval[e]! * v;
    }
    // U: back substitution, last step first; x[q_k] from row p_k (every entry is written).
    const x = this.work;
    for (let k = m - 1; k >= 0; k--) {
      let s = a[pivotRow[k]!]!;
      for (let e = Ustart[k]!; e < Ustart[k + 1]!; e++) s -= Uval[e]! * x[Ucol[e]!]!;
      x[pivotCol[k]!] = s / Upivot[k]!;
    }
    // The changes of basis, oldest first: each is E⁻¹, E being I with column r replaced by the entering column w.
    for (let t = 0; t < this.etaPos.length; t++) {
      const r = this.etaPos[t]!;
      const xr = x[r]! / this.etaPivot[t]!;
      if (xr !== 0) {
        const idx = this.etaIndex[t]!;
        const val = this.etaValue[t]!;
        for (let e = 0; e < idx.length; e++) x[idx[e]!]! -= val[e]! * xr;
      }
      x[r] = xr;
    }
    a.set(x);
    return a;
  }

  /** Solves Bᵀ y = e (e by position, y by row), overwriting and returning `e` (backward transformation, BTRAN). */
  btran(e: Float64Array): Float64Array {
    const m = this.m;
    const { pivotRow, pivotCol, Lstart, Lrow, Lval, Upivot, Ustart, Ucol, Uval } = this;
    // The changes of basis, newest first: Eᵀ z' = z changes only entry r.
    for (let t = this.etaPos.length - 1; t >= 0; t--) {
      const r = this.etaPos[t]!;
      const idx = this.etaIndex[t]!;
      const val = this.etaValue[t]!;
      let s = e[r]!;
      for (let k = 0; k < idx.length; k++) if (idx[k] !== r) s -= val[k]! * e[idx[k]!]!;
      e[r] = s / this.etaPivot[t]!;
    }
    // Uᵀ v = e, in step order: v[p_k] from column q_k, then its U row's other columns lose its share.
    const r = this.work;
    r.set(e);
    const v = this.work2;
    for (let k = 0; k < m; k++) {
      const vk = r[pivotCol[k]!]! / Upivot[k]!;
      v[pivotRow[k]!] = vk;
      if (vk === 0) continue;
      for (let t = Ustart[k]!; t < Ustart[k + 1]!; t++) r[Ucol[t]!]! -= Uval[t]! * vk;
    }
    // y = Lᵀ-wise: the elimination steps transposed, last first.
    for (let k = m - 1; k >= 0; k--) {
      let s = v[pivotRow[k]!]!;
      for (let t = Lstart[k]!; t < Lstart[k + 1]!; t++) s -= Lval[t]! * v[Lrow[t]!]!;
      v[pivotRow[k]!] = s;
    }
    e.set(v);
    return e;
  }

  /** Records a change of basis: the column at position r is replaced by one whose FTRAN is `alpha` (B⁻¹ a_q). */
  update(r: number, alpha: Float64Array): void {
    const idx: number[] = [];
    const val: number[] = [];
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] !== 0 && i !== r) {
        idx.push(i);
        val.push(alpha[i]!);
      }
    }
    this.etaPos.push(r);
    this.etaPivot.push(alpha[r]!);
    this.etaIndex.push(Int32Array.from(idx));
    this.etaValue.push(Float64Array.from(val));
  }
}

/** Up to SEARCH not-done indices with the smallest sizes, smallest first. */
function shortest(m: number, done: Uint8Array, size: (i: number) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < m; i++) {
    if (done[i]) continue;
    const s = size(i);
    if (out.length < SEARCH || s < size(out[out.length - 1]!)) {
      let at = out.length;
      while (at > 0 && size(out[at - 1]!) > s) at--;
      out.splice(at, 0, i);
      if (out.length > SEARCH) out.pop();
    }
  }
  return out;
}

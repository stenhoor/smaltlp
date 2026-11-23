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

  /**
   * A copy that can go on from here without changing this one: L and U are never changed once factored, so they are
   * shared; the list of changes of basis is copied.
   */
  clone(): BasisFactor {
    const c = new BasisFactor(this.m);
    c.pivotRow = this.pivotRow;
    c.pivotCol = this.pivotCol;
    c.Lstart = this.Lstart;
    c.Lrow = this.Lrow;
    c.Lval = this.Lval;
    c.Upivot = this.Upivot;
    c.Ustart = this.Ustart;
    c.Ucol = this.Ucol;
    c.Uval = this.Uval;
    c.etaPos = this.etaPos.slice();
    c.etaPivot = this.etaPivot.slice();
    c.etaIndex = this.etaIndex.slice();
    c.etaValue = this.etaValue.slice();
    return c;
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
    // The active submatrix, by rows (columns and values, in the order they arrived) and by columns (the rows with an
    // entry). Each row and column is its own typed array, grown by doubling; lengths are kept apart.
    const rLen = new Int32Array(m);
    const cLen = new Int32Array(m);
    for (let j = 0; j < m; j++) {
      const c = columns[j]!;
      for (let k = 0; k < c.index.length; k++) if (c.value[k] !== 0) rLen[c.index[k]!]!++;
      cLen[j] = c.index.length;
    }
    const rCol: Int32Array[] = new Array(m);
    const rVal: Float64Array[] = new Array(m);
    const cRow: Int32Array[] = new Array(m);
    for (let i = 0; i < m; i++) {
      rCol[i] = new Int32Array(2 * rLen[i]! + 4);
      rVal[i] = new Float64Array(2 * rLen[i]! + 4);
      rLen[i] = 0;
    }
    for (let j = 0; j < m; j++) {
      cRow[j] = new Int32Array(2 * cLen[j]! + 4);
      cLen[j] = 0;
    }
    for (let j = 0; j < m; j++) {
      const c = columns[j]!;
      for (let k = 0; k < c.index.length; k++) {
        const v = c.value[k]!;
        if (v === 0) continue;
        const i = c.index[k]!;
        const n = rLen[i]!;
        // A repeated row in one column adds to its entry, which is row i's last.
        if (n > 0 && rCol[i]![n - 1] === j) {
          rVal[i]![n - 1]! += v;
          continue;
        }
        rCol[i]![n] = j;
        rVal[i]![n] = v;
        rLen[i] = n + 1;
        cRow[j]![cLen[j]!] = i;
        cLen[j]!++;
      }
    }
    /** a_ij, or 0. */
    const get = (i: number, j: number): number => {
      const cs = rCol[i]!;
      for (let t = 0, n = rLen[i]!; t < n; t++) if (cs[t] === j) return rVal[i]![t]!;
      return 0;
    };
    const colAppend = (j: number, i: number): void => {
      let rs = cRow[j]!;
      const n = cLen[j]!;
      if (n === rs.length) {
        const grown = new Int32Array(2 * n + 4);
        grown.set(rs);
        cRow[j] = rs = grown;
      }
      rs[n] = i;
      cLen[j] = n + 1;
    };
    /** Takes row i out of column j's list, keeping the others' order. */
    const colRemove = (j: number, i: number): void => {
      const rs = cRow[j]!;
      const n = cLen[j]!;
      let t = 0;
      while (t < n && rs[t] !== i) t++;
      if (t === n) return;
      rs.copyWithin(t, t + 1, n);
      cLen[j] = n - 1;
    };
    const colMax = (j: number): number => {
      let big = 0;
      const rs = cRow[j]!;
      for (let t = 0, n = cLen[j]!; t < n; t++) big = Math.max(big, Math.abs(get(rs[t]!, j)));
      return big;
    };

    const rowDone = new Uint8Array(m);
    const colDone = new Uint8Array(m);
    const pivotRow = new Int32Array(m);
    const pivotCol = new Int32Array(m);
    const Lstart = new Int32Array(m + 1);
    let Lrow = new Int32Array(m + 4);
    let Lval = new Float64Array(m + 4);
    let nL = 0;
    const Upivot = new Float64Array(m);
    const Ustart = new Int32Array(m + 1);
    let Ucol = new Int32Array(2 * m + 4);
    let Uval = new Float64Array(2 * m + 4);
    let nU = 0;
    // Row p's entries, scattered by column for the step: where in row p column j is, when inP[j] is the step's mark.
    const inP = new Int32Array(m).fill(-1);
    const atP = new Int32Array(m);
    // The columns a row being updated already has, marked with that row's own number.
    const seen = new Int32Array(m).fill(-1);
    let rowMark = 0;
    const shortCols = new Int32Array(SEARCH);
    const shortRows = new Int32Array(SEARCH);

    for (let k = 0; k < m; k++) {
      // The SEARCH shortest active columns and rows.
      const nc = shortest(m, colDone, cLen, shortCols);
      const nr = shortest(m, rowDone, rLen, shortRows);
      if (nc === 0 || cLen[shortCols[0]!] === 0) return false;
      let p = -1;
      let q = -1;
      let best = Infinity;
      let bestSize = 0;
      const consider = (i: number, j: number, a: number, cmax: number) => {
        if (Math.abs(a) < THRESHOLD * cmax) return;
        const cost = (rLen[i]! - 1) * (cLen[j]! - 1);
        if (cost < best || (cost === best && Math.abs(a) > bestSize)) {
          best = cost;
          bestSize = Math.abs(a);
          p = i;
          q = j;
        }
      };
      for (let s = 0; s < nc; s++) {
        const j = shortCols[s]!;
        const cmax = colMax(j);
        if (cmax < SINGULAR) return false;
        const rs = cRow[j]!;
        for (let t = 0, n = cLen[j]!; t < n; t++) consider(rs[t]!, j, get(rs[t]!, j), cmax);
        if (best === 0) break;
      }
      if (best !== 0) {
        for (let s = 0; s < nr; s++) {
          const i = shortRows[s]!;
          const cs = rCol[i]!;
          const vs = rVal[i]!;
          for (let t = 0, n = rLen[i]!; t < n; t++) consider(i, cs[t]!, vs[t]!, colMax(cs[t]!));
          if (best === 0) break;
        }
      }
      if (p < 0) return false;

      // Eliminate: every other active row with an entry in column q loses l × row p.
      const pCol = rCol[p]!;
      const pVal = rVal[p]!;
      const pLen = rLen[p]!;
      for (let t = 0; t < pLen; t++) {
        inP[pCol[t]!] = k;
        atP[pCol[t]!] = t;
      }
      const d = pVal[atP[q]!]!;
      pivotRow[k] = p;
      pivotCol[k] = q;
      Upivot[k] = d;
      const qRows = cRow[q]!;
      for (let s = 0, nq = cLen[q]!; s < nq; s++) {
        const i = qRows[s]!;
        if (i === p) continue;
        const mark = rowMark++;
        let cs = rCol[i]!;
        let vs = rVal[i]!;
        let n = rLen[i]!;
        // Row i's own entries, in place: column q goes, those row p shares change, and any that reach 0 go.
        let l = 0;
        let w = 0;
        for (let t = 0; t < n; t++) {
          if (cs[t] === q) {
            l = vs[t]! / d;
            break;
          }
        }
        for (let t = 0; t < n; t++) {
          const j = cs[t]!;
          let v = vs[t]!;
          if (j === q) continue;
          if (inP[j] === k) {
            seen[j] = mark;
            v -= l * pVal[atP[j]!]!;
            if (v === 0) {
              colRemove(j, i);
              continue;
            }
          }
          cs[w] = j;
          vs[w] = v;
          w++;
        }
        n = w;
        // Fill-in: row p's other columns that row i lacks, in row p's order.
        for (let t = 0; t < pLen; t++) {
          const j = pCol[t]!;
          if (j === q || seen[j] === mark) continue;
          const v = 0 - l * pVal[t]!;
          if (v === 0) continue;
          if (n === cs.length) {
            const gc = new Int32Array(2 * n + 4);
            const gv = new Float64Array(2 * n + 4);
            gc.set(cs);
            gv.set(vs);
            rCol[i] = cs = gc;
            rVal[i] = vs = gv;
          }
          cs[n] = j;
          vs[n] = v;
          n++;
          colAppend(j, i);
        }
        rLen[i] = n;
        if (nL === Lrow.length) {
          const gr = new Int32Array(2 * nL);
          const gv = new Float64Array(2 * nL);
          gr.set(Lrow);
          gv.set(Lval);
          Lrow = gr;
          Lval = gv;
        }
        Lrow[nL] = i;
        Lval[nL] = l;
        nL++;
      }
      Lstart[k + 1] = nL;
      // Row p becomes step k's U row, and leaves the active submatrix with column q.
      if (nU + pLen > Ucol.length) {
        const size = 2 * (nU + pLen);
        const gc = new Int32Array(size);
        const gv = new Float64Array(size);
        gc.set(Ucol);
        gv.set(Uval);
        Ucol = gc;
        Uval = gv;
      }
      for (let t = 0; t < pLen; t++) {
        const j = pCol[t]!;
        if (j === q) continue;
        colRemove(j, p);
        Ucol[nU] = j;
        Uval[nU] = pVal[t]!;
        nU++;
      }
      Ustart[k + 1] = nU;
      cLen[q] = 0;
      rowDone[p] = 1;
      colDone[q] = 1;
    }

    this.pivotRow = pivotRow;
    this.pivotCol = pivotCol;
    this.Lstart = Lstart;
    this.Lrow = Lrow.slice(0, nL);
    this.Lval = Lval.slice(0, nL);
    this.Upivot = Upivot;
    this.Ustart = Ustart;
    this.Ucol = Ucol.slice(0, nU);
    this.Uval = Uval.slice(0, nU);
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

/** Up to SEARCH not-done indices with the smallest sizes, smallest first (ties in index order), into `out`; returns how many. */
function shortest(m: number, done: Uint8Array, size: Int32Array, out: Int32Array): number {
  let count = 0;
  for (let i = 0; i < m; i++) {
    if (done[i]) continue;
    const s = size[i]!;
    if (count < SEARCH || s < size[out[count - 1]!]!) {
      let at = count;
      while (at > 0 && size[out[at - 1]!]! > s) at--;
      const last = count < SEARCH ? count : SEARCH - 1;
      out.copyWithin(at + 1, at, last);
      out[at] = i;
      if (count < SEARCH) count++;
    }
  }
  return count;
}

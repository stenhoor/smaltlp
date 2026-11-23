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
  /** Work space for factor, made at its first call and kept. */
  private space: Space | null = null;

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
    return this.Lstart[this.Lstart.length - 1]! + this.Ustart[this.Ustart.length - 1]! + this.m;
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
    const work = (this.space ??= newSpace(m));
    const { rLen, cLen, rPos, rCap, cPos, cCap, cHead, cNext, cPrev, rHead, rNext, rPrev, inP, atP, seen, pCol, pVal } = work;
    // The active submatrix, by rows (columns and values, in the order they arrived) and by columns (the rows with an
    // entry), each a stretch of one shared pool: row i is rIdx/rV[rPos[i] … rPos[i] + rLen[i]), with room for rCap[i].
    // A row or column that outgrows its room moves to the pool's end; a full pool is copied, packed, into a bigger one.
    // The pools are kept between factorizations.
    rLen.fill(0);
    cLen.fill(0);
    for (let j = 0; j < m; j++) {
      const c = columns[j]!;
      for (let k = 0; k < c.index.length; k++) {
        if (c.value[k] === 0) continue;
        rLen[c.index[k]!]!++;
        cLen[j]!++;
      }
    }
    let rEnd = 0;
    let cEnd = 0;
    for (let i = 0; i < m; i++) {
      rPos[i] = rEnd;
      rCap[i] = 2 * rLen[i]! + 4;
      rEnd += rCap[i]!;
      rLen[i] = 0;
    }
    for (let j = 0; j < m; j++) {
      cPos[j] = cEnd;
      cCap[j] = 2 * cLen[j]! + 4;
      cEnd += cCap[j]!;
      cLen[j] = 0;
    }
    if (work.rIdx.length < rEnd + (rEnd >> 1)) {
      work.rIdx = new Int32Array(2 * rEnd);
      work.rV = new Float64Array(2 * rEnd);
    }
    if (work.cIdx.length < cEnd + (cEnd >> 1)) work.cIdx = new Int32Array(2 * cEnd);
    let { rIdx, rV, cIdx } = work;
    for (let j = 0; j < m; j++) {
      const c = columns[j]!;
      for (let k = 0; k < c.index.length; k++) {
        const v = c.value[k]!;
        if (v === 0) continue;
        const i = c.index[k]!;
        const n = rLen[i]!;
        const at = rPos[i]! + n;
        // A repeated row in one column adds to its entry, which is row i's last.
        if (n > 0 && rIdx[at - 1] === j) {
          rV[at - 1]! += v;
          continue;
        }
        rIdx[at] = j;
        rV[at] = v;
        rLen[i] = n + 1;
        cIdx[cPos[j]! + cLen[j]!] = i;
        cLen[j]!++;
      }
    }

    /** Gives row i room for `need` entries, at the pool's end. */
    const growRow = (i: number, need: number): void => {
      const cap = Math.max(2 * rCap[i]!, need) + 4;
      if (rEnd + cap > rIdx.length) {
        let total = cap;
        for (let r = 0; r < m; r++) total += rLen[r]! + 4;
        const gi = new Int32Array(Math.max(2 * rIdx.length, 2 * total));
        const gv = new Float64Array(gi.length);
        let at = 0;
        for (let r = 0; r < m; r++) {
          gi.set(rIdx.subarray(rPos[r]!, rPos[r]! + rLen[r]!), at);
          gv.set(rV.subarray(rPos[r]!, rPos[r]! + rLen[r]!), at);
          rPos[r] = at;
          rCap[r] = rLen[r]! + 4;
          at += rCap[r]!;
        }
        work.rIdx = rIdx = gi;
        work.rV = rV = gv;
        rEnd = at;
      }
      rIdx.copyWithin(rEnd, rPos[i]!, rPos[i]! + rLen[i]!);
      rV.copyWithin(rEnd, rPos[i]!, rPos[i]! + rLen[i]!);
      rPos[i] = rEnd;
      rCap[i] = cap;
      rEnd += cap;
    };
    const colAppend = (j: number, i: number): void => {
      const n = cLen[j]!;
      if (n === cCap[j]) {
        const cap = 2 * n + 4;
        if (cEnd + cap > cIdx.length) {
          let total = cap;
          for (let c = 0; c < m; c++) total += cLen[c]! + 4;
          const gi = new Int32Array(Math.max(2 * cIdx.length, 2 * total));
          let at = 0;
          for (let c = 0; c < m; c++) {
            gi.set(cIdx.subarray(cPos[c]!, cPos[c]! + cLen[c]!), at);
            cPos[c] = at;
            cCap[c] = cLen[c]! + 4;
            at += cCap[c]!;
          }
          work.cIdx = cIdx = gi;
          cEnd = at;
        }
        cIdx.copyWithin(cEnd, cPos[j]!, cPos[j]! + n);
        cPos[j] = cEnd;
        cCap[j] = cap;
        cEnd += cap;
      }
      cIdx[cPos[j]! + n] = i;
      cLen[j] = n + 1;
      unlink(cHead, cNext, cPrev, j, n);
      link(cHead, cNext, cPrev, j, n + 1);
    };
    /** Takes row i out of column j's list, keeping the others' order. */
    const colRemove = (j: number, i: number): void => {
      const base = cPos[j]!;
      const n = cLen[j]!;
      let t = 0;
      while (t < n && cIdx[base + t] !== i) t++;
      if (t === n) return;
      cIdx.copyWithin(base + t, base + t + 1, base + n);
      cLen[j] = n - 1;
      unlink(cHead, cNext, cPrev, j, n);
      link(cHead, cNext, cPrev, j, n - 1);
    };
    /** a_ij, or 0. */
    const get = (i: number, j: number): number => {
      const base = rPos[i]!;
      for (let t = base, e = base + rLen[i]!; t < e; t++) if (rIdx[t] === j) return rV[t]!;
      return 0;
    };
    const colMax = (j: number): number => {
      let big = 0;
      const base = cPos[j]!;
      for (let t = base, e = base + cLen[j]!; t < e; t++) big = Math.max(big, Math.abs(get(cIdx[t]!, j)));
      return big;
    };

    // The active columns and rows, each in a doubly linked list by its count of entries, so the pivot search finds the
    // shortest without scanning them all. When a count changes, the list follows (it moves to the front of its new one).
    // In index order to start with: each list is built from the highest index down.
    cHead.fill(-1);
    rHead.fill(-1);
    for (let j = m - 1; j >= 0; j--) link(cHead, cNext, cPrev, j, cLen[j]!);
    for (let i = m - 1; i >= 0; i--) link(rHead, rNext, rPrev, i, rLen[i]!);
    // Row p's entries, scattered by column for step k: where in row p column j is, when inP[j] is k.
    inP.fill(-1);
    // The columns a row being updated already has, marked with that row's own number.
    seen.fill(-1);
    let rowMark = 0;

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
    const { shortCols, shortRows } = work;

    for (let k = 0; k < m; k++) {
      // The SEARCH shortest active columns and rows.
      const nc = shortest(m, cHead, cNext, shortCols);
      const nr = shortest(m, rHead, rNext, shortRows);
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
        const base = cPos[j]!;
        for (let t = base, e = base + cLen[j]!; t < e; t++) consider(cIdx[t]!, j, get(cIdx[t]!, j), cmax);
        if (best === 0) break;
      }
      if (best !== 0) {
        for (let s = 0; s < nr; s++) {
          const i = shortRows[s]!;
          const base = rPos[i]!;
          for (let t = base, e = base + rLen[i]!; t < e; t++) consider(i, rIdx[t]!, rV[t]!, colMax(rIdx[t]!));
          if (best === 0) break;
        }
      }
      if (p < 0) return false;

      // Row p, copied out (other rows' growth can move it in the pool), and scattered by column.
      const pLen = rLen[p]!;
      for (let t = 0, base = rPos[p]!; t < pLen; t++) {
        const j = rIdx[base + t]!;
        pCol[t] = j;
        pVal[t] = rV[base + t]!;
        inP[j] = k;
        atP[j] = t;
      }
      const d = pVal[atP[q]!]!;
      pivotRow[k] = p;
      pivotCol[k] = q;
      Upivot[k] = d;
      // Eliminate: every other active row with an entry in column q loses l × row p.
      for (let s = 0, nq = cLen[q]!; s < nq; s++) {
        const i = cIdx[cPos[q]! + s]!;
        if (i === p) continue;
        const mark = rowMark++;
        let base = rPos[i]!;
        const before = rLen[i]!;
        let n = before;
        let l = 0;
        for (let t = base; t < base + n; t++) {
          if (rIdx[t] === q) {
            l = rV[t]! / d;
            break;
          }
        }
        // Row i's own entries, in place: column q goes, those row p shares change, and any that reach 0 go.
        let w = base;
        let shared = 0;
        for (let t = base; t < base + n; t++) {
          const j = rIdx[t]!;
          let v = rV[t]!;
          if (j === q) continue;
          if (inP[j] === k) {
            seen[j] = mark;
            shared++;
            v -= l * pVal[atP[j]!]!;
            if (v === 0) {
              colRemove(j, i);
              continue;
            }
          }
          rIdx[w] = j;
          rV[w] = v;
          w++;
        }
        n = w - base;
        // Fill-in: row p's other columns that row i lacks, in row p's order.
        const fill = pLen - 1 - shared;
        if (n + fill > rCap[i]!) {
          rLen[i] = n;
          growRow(i, n + fill);
          base = rPos[i]!;
        }
        for (let t = 0; t < pLen; t++) {
          const j = pCol[t]!;
          if (j === q || seen[j] === mark) continue;
          const v = 0 - l * pVal[t]!;
          if (v === 0) continue;
          rIdx[base + n] = j;
          rV[base + n] = v;
          n++;
          colAppend(j, i);
        }
        if (n !== before) {
          unlink(rHead, rNext, rPrev, i, before);
          link(rHead, rNext, rPrev, i, n);
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
      unlink(cHead, cNext, cPrev, q, cLen[q]!);
      unlink(rHead, rNext, rPrev, p, rLen[p]!);
      cLen[q] = 0;
    }

    // L and U are new arrays each time, a little longer than they need be: clones share them.
    this.pivotRow = pivotRow;
    this.pivotCol = pivotCol;
    this.Lstart = Lstart;
    this.Lrow = Lrow;
    this.Lval = Lval;
    this.Upivot = Upivot;
    this.Ustart = Ustart;
    this.Ucol = Ucol;
    this.Uval = Uval;
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

/** factor's work space: arrays of length m, and the pools, which grow. */
interface Space {
  rLen: Int32Array;
  cLen: Int32Array;
  rPos: Int32Array;
  rCap: Int32Array;
  cPos: Int32Array;
  cCap: Int32Array;
  cHead: Int32Array;
  cNext: Int32Array;
  cPrev: Int32Array;
  rHead: Int32Array;
  rNext: Int32Array;
  rPrev: Int32Array;
  inP: Int32Array;
  atP: Int32Array;
  seen: Int32Array;
  pCol: Int32Array;
  pVal: Float64Array;
  shortCols: Int32Array;
  shortRows: Int32Array;
  rIdx: Int32Array;
  rV: Float64Array;
  cIdx: Int32Array;
}

function newSpace(m: number): Space {
  const ints = () => new Int32Array(m);
  return {
    rLen: ints(), cLen: ints(), rPos: ints(), rCap: ints(), cPos: ints(), cCap: ints(),
    cHead: new Int32Array(m + 1), cNext: ints(), cPrev: ints(),
    rHead: new Int32Array(m + 1), rNext: ints(), rPrev: ints(),
    inP: ints(), atP: ints(), seen: ints(), pCol: ints(), pVal: new Float64Array(m),
    shortCols: new Int32Array(SEARCH), shortRows: new Int32Array(SEARCH),
    rIdx: new Int32Array(0), rV: new Float64Array(0), cIdx: new Int32Array(0),
  };
}

/** Puts x at the front of the list for `count`. */
function link(head: Int32Array, next: Int32Array, prev: Int32Array, x: number, count: number): void {
  const h = head[count]!;
  next[x] = h;
  prev[x] = -1;
  if (h >= 0) prev[h] = x;
  head[count] = x;
}

/** Takes x out of the list for `count`. */
function unlink(head: Int32Array, next: Int32Array, prev: Int32Array, x: number, count: number): void {
  const a = prev[x]!;
  const b = next[x]!;
  if (a >= 0) next[a] = b;
  else head[count] = b;
  if (b >= 0) prev[b] = a;
}

/** Up to SEARCH active indices with the fewest entries, fewest first, from the lists by count, into `out`; returns how many. */
function shortest(m: number, head: Int32Array, next: Int32Array, out: Int32Array): number {
  let count = 0;
  for (let c = 0; c <= m && count < SEARCH; c++) {
    for (let x = head[c]!; x >= 0 && count < SEARCH; x = next[x]!) out[count++] = x;
  }
  return count;
}

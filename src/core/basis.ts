/**
 * The basis factorization the simplex method solves with: B = Pᵀ L U, by Gaussian elimination with partial pivoting,
 * and the product form for the bases that follow, one eta column per change of basis, until the next
 * refactorization.
 *
 * This first version keeps L and U dense: O(m²) memory and O(m³) work to factor, which suits the small models of
 * phase 1's first slice. A sparse LU (Markowitz pivoting, Forrest–Tomlin updates) replaces it later, behind the same
 * methods (smaltworks ADR 0039, section 4).
 * @module
 */

/** A basis matrix is singular, or too close to it to factor: its pivot was below this, relative to its column. */
export const SINGULAR = 1e-11;

/** The factorization of a basis matrix B (m × m) and the changes of basis since. */
export class BasisFactor {
  readonly m: number;
  /** L (below the diagonal, unit diagonal implied) and U (on and above it), row-major. */
  private lu: Float64Array;
  /** Row i of P B is row perm[i] of B. */
  private perm: Int32Array;
  /** The product form: for each change of basis, the row it replaced and the entering column B⁻¹ a_q. */
  private etaRow: number[] = [];
  private etaCol: Float64Array[] = [];

  constructor(m: number) {
    this.m = m;
    this.lu = new Float64Array(m * m);
    this.perm = new Int32Array(m);
  }

  /** The number of changes of basis since the last factorization. */
  get updates(): number {
    return this.etaRow.length;
  }

  /**
   * Factors B, given row-major (B[r * m + i] is row r of column i). Returns false where B is singular to working
   * precision, and leaves the previous factorization unusable.
   */
  factor(B: Float64Array): boolean {
    const m = this.m;
    const a = this.lu;
    a.set(B);
    for (let i = 0; i < m; i++) this.perm[i] = i;
    this.etaRow = [];
    this.etaCol = [];
    for (let k = 0; k < m; k++) {
      // The column's largest entry, at or below the diagonal, is the pivot.
      let piv = k;
      let big = Math.abs(a[k * m + k]!);
      let colMax = big;
      for (let i = k + 1; i < m; i++) {
        const v = Math.abs(a[i * m + k]!);
        if (v > big) {
          big = v;
          piv = i;
        }
        if (v > colMax) colMax = v;
      }
      for (let i = 0; i < k; i++) colMax = Math.max(colMax, Math.abs(a[i * m + k]!));
      if (big === 0 || big < SINGULAR * colMax) return false;
      if (piv !== k) {
        for (let j = 0; j < m; j++) {
          const t = a[k * m + j]!;
          a[k * m + j] = a[piv * m + j]!;
          a[piv * m + j] = t;
        }
        const t = this.perm[k]!;
        this.perm[k] = this.perm[piv]!;
        this.perm[piv] = t;
      }
      const d = a[k * m + k]!;
      for (let i = k + 1; i < m; i++) {
        const l = (a[i * m + k]! /= d);
        if (l === 0) continue;
        for (let j = k + 1; j < m; j++) a[i * m + j]! -= l * a[k * m + j]!;
      }
    }
    return true;
  }

  /** Solves B x = a, overwriting and returning `a` (forward transformation, FTRAN). */
  ftran(a: Float64Array): Float64Array {
    const m = this.m;
    const lu = this.lu;
    const b = new Float64Array(m);
    for (let i = 0; i < m; i++) b[i] = a[this.perm[i]!]!;
    for (let i = 0; i < m; i++) {
      let s = b[i]!;
      for (let k = 0; k < i; k++) s -= lu[i * m + k]! * b[k]!;
      b[i] = s;
    }
    for (let i = m - 1; i >= 0; i--) {
      let s = b[i]!;
      for (let k = i + 1; k < m; k++) s -= lu[i * m + k]! * b[k]!;
      b[i] = s / lu[i * m + i]!;
    }
    // The changes of basis, oldest first: each is E⁻¹, E being I with column r replaced by w.
    for (let e = 0; e < this.etaRow.length; e++) {
      const r = this.etaRow[e]!;
      const w = this.etaCol[e]!;
      const xr = b[r]! / w[r]!;
      if (xr !== 0) for (let i = 0; i < m; i++) b[i]! -= w[i]! * xr;
      b[r] = xr;
    }
    a.set(b);
    return a;
  }

  /** Solves Bᵀ y = e, overwriting and returning `e` (backward transformation, BTRAN). */
  btran(e: Float64Array): Float64Array {
    const m = this.m;
    const lu = this.lu;
    const z = e;
    // The changes of basis, newest first: Eᵀ z' = z keeps every entry but r.
    for (let k = this.etaRow.length - 1; k >= 0; k--) {
      const r = this.etaRow[k]!;
      const w = this.etaCol[k]!;
      let s = z[r]!;
      for (let i = 0; i < m; i++) if (i !== r) s -= w[i]! * z[i]!;
      z[r] = s / w[r]!;
    }
    // Bᵀ = Uᵀ Lᵀ P: solve Uᵀ u = z, then Lᵀ v = u, then y[perm[i]] = v[i].
    const u = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let s = z[i]!;
      for (let k = 0; k < i; k++) s -= lu[k * m + i]! * u[k]!;
      u[i] = s / lu[i * m + i]!;
    }
    for (let i = m - 1; i >= 0; i--) {
      let s = u[i]!;
      for (let k = i + 1; k < m; k++) s -= lu[k * m + i]! * u[k]!;
      u[i] = s;
    }
    for (let i = 0; i < m; i++) z[this.perm[i]!] = u[i]!;
    return z;
  }

  /** Records a change of basis: the column at row r is replaced by one whose FTRAN is `alpha` (B⁻¹ a_q). */
  update(r: number, alpha: Float64Array): void {
    this.etaRow.push(r);
    this.etaCol.push(alpha.slice());
  }
}

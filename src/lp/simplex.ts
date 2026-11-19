/**
 * The bounded dual simplex method, in 64-bit floats (smaltworks ADR 0039, section 4).
 *
 * The problem, in computational form: minimize cᵀx subject to rowLo ≤ A x ≤ rowUp and colLo ≤ x ≤ colUp. Each row
 * gets a logical variable s = a_r x, so the constraints are [A −I] (x, s) = 0 with bounds on every variable, and the
 * logicals give the first basis, B = −I.
 *
 * The method keeps the reduced costs dual feasible and works the basic variables into their bounds: each iteration
 * a basic variable outside its bounds leaves at the bound it violates, chosen by dual steepest edge pricing
 * (Forrest and Goldfarb, 1992: the largest infeasibility² / ‖row r of B⁻¹‖²), the ratio test chooses the entering
 * variable that keeps every reduced cost's sign (Harris's two passes, the largest pivot among near-ties), and the
 * basis changes. It is optimal when every basic variable is within its bounds.
 *
 * A nonbasic variable must sit at a bound its reduced cost allows. Where that bound is infinite, it sits at an
 * artificial bound ±M instead ("artificial bounding"). At the end, a variable still on an artificial bound either
 * moves off it at no cost, or shows the box was too small: M grows, and if it grows past 1e14 the problem is
 * unbounded. A dual ray that relies on an artificial bound grows M the same way before infeasibility is reported.
 *
 * Written from the published descriptions of the method (Koberstein's thesis, Paderborn 2005; Maros, Computational
 * Techniques of the Simplex Method, 2003), not from any solver's code.
 * @module
 */
import { BasisFactor, type SparseColumn } from '../core/basis.ts';
import type { Csc } from '../core/sparse.ts';

/** A linear program in computational form. */
export interface Lp {
  /** The constraint matrix, m × n. */
  A: Csc;
  c: Float64Array;
  colLo: Float64Array;
  colUp: Float64Array;
  rowLo: Float64Array;
  rowUp: Float64Array;
}

/** How the solve ended: scipy's status codes. */
export type Status = 0 | 1 | 2 | 3 | 4;

export interface SimplexOptions {
  /** The most iterations (changes of basis). */
  maxIter: number;
  /** Primal feasibility: how far outside its bounds a variable may be. */
  primalTol: number;
  /** Dual feasibility: how far a reduced cost may have the wrong sign. */
  dualTol: number;
  /**
   * A basis to start from (a warm start): the m basic variables, as indices into the n structurals then the m
   * logicals, such as an earlier result's `basis`. Where it isn't m distinct variables, or its matrix is singular, the
   * solve starts from the logicals instead. Its dual steepest edge weights start at 1.
   */
  basis?: ArrayLike<number>;
}

export interface SimplexResult {
  status: Status;
  /** Changes of basis made. */
  nit: number;
  /** Every variable's value: the n structurals, then the m logicals (each row's activity a_r x). */
  x: Float64Array;
  /** Every variable's reduced cost, structurals then logicals. A logical's is its row's dual value. */
  d: Float64Array;
  /** Whether each variable was nonbasic at its lower bound (-1), upper bound (1), or neither (0). */
  at: Int8Array;
  /** The optimal basis's m basic variables (structurals then logicals), to start a later solve from; null unless status is 0. */
  basis: Int32Array | null;
}

const BASIC = 0;
const AT_LOWER = 1;
const AT_UPPER = 2;
const FIXED = 3;
const FREE = 4;

/** The pivot an entering column must have, at least, in the ratio test. */
const PIVOT_TOL = 1e-9;
/** The artificial bound's first size, and the largest before the problem counts as unbounded. */
const BOX_START = 1e6;
const BOX_LIMIT = 1e14;
/** Changes of basis between refactorizations. */
const REFACTOR = 64;

export function dualSimplex(lp: Lp, opts: SimplexOptions): SimplexResult {
  return new DualSimplex(lp, opts).run();
}

class DualSimplex {
  private readonly A: Csc;
  private readonly m: number;
  private readonly n: number;
  private readonly N: number;
  private readonly lo: Float64Array;
  private readonly up: Float64Array;
  private readonly cost: Float64Array;
  /** The costs shifted to repair small dual infeasibilities from rounding; removed before the end. */
  private readonly shift: Float64Array;
  private readonly x: Float64Array;
  private readonly d: Float64Array;
  private readonly kind: Int8Array;
  /** Nonbasic on an artificial bound: -1 below, +1 above, 0 not. */
  private readonly art: Int8Array;
  private readonly head: Int32Array;
  /** Dual steepest edge weights: weight[i] = ‖e_iᵀ B⁻¹‖², kept up to date at each change of basis. */
  private readonly weight: Float64Array;
  private readonly factor: BasisFactor;
  private readonly opts: SimplexOptions;
  private box = BOX_START;
  private nit = 0;

  constructor(lp: Lp, opts: SimplexOptions) {
    this.opts = opts;
    this.A = lp.A;
    this.m = lp.A.rows;
    this.n = lp.A.cols;
    this.N = this.n + this.m;
    const { n, m, N } = this;
    this.lo = new Float64Array(N);
    this.up = new Float64Array(N);
    this.cost = new Float64Array(N);
    this.lo.set(lp.colLo);
    this.up.set(lp.colUp);
    this.lo.set(lp.rowLo, n);
    this.up.set(lp.rowUp, n);
    this.cost.set(lp.c);
    this.shift = new Float64Array(N);
    this.x = new Float64Array(N);
    this.d = new Float64Array(N);
    this.kind = new Int8Array(N);
    this.art = new Int8Array(N);
    this.head = new Int32Array(m);
    // The first basis is −I, whose rows of B⁻¹ have norm 1.
    this.weight = new Float64Array(m).fill(1);
    this.factor = new BasisFactor(m);
    for (let i = 0; i < m; i++) this.head[i] = n + i;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Columns of [A −I]

  /** Adds `scale` times column j of [A −I] into `into`. */
  private addColumn(j: number, scale: number, into: Float64Array): void {
    if (j >= this.n) {
      into[j - this.n]! -= scale;
      return;
    }
    const A = this.A;
    for (let p = A.start[j]!; p < A.start[j + 1]!; p++) into[A.index[p]!]! += scale * A.value[p]!;
  }

  /** Column j of [A −I], dotted with v. */
  private dot(j: number, v: Float64Array): number {
    if (j >= this.n) return -v[j - this.n]!;
    const A = this.A;
    let s = 0;
    for (let p = A.start[j]!; p < A.start[j + 1]!; p++) s += A.value[p]! * v[A.index[p]!]!;
    return s;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Basis, primal values and reduced costs

  private refactor(): boolean {
    // The basis's columns, sparse: a structural's column of A, or a logical's −e_r.
    const A = this.A;
    const cols: SparseColumn[] = [];
    for (let i = 0; i < this.m; i++) {
      const j = this.head[i]!;
      if (j >= this.n) cols.push({ index: [j - this.n], value: [-1] });
      else cols.push({ index: A.index.subarray(A.start[j]!, A.start[j + 1]!), value: A.value.subarray(A.start[j]!, A.start[j + 1]!) });
    }
    return this.factor.factor(cols);
  }

  /** The basic variables' values, from the nonbasic ones: B x_B = −N x_N. */
  private computePrimal(): void {
    const rhs = new Float64Array(this.m);
    for (let j = 0; j < this.N; j++) if (this.kind[j] !== BASIC && this.x[j] !== 0) this.addColumn(j, -this.x[j]!, rhs);
    this.factor.ftran(rhs);
    for (let i = 0; i < this.m; i++) this.x[this.head[i]!] = rhs[i]!;
  }

  /** The duals y (Bᵀ y = c_B) and every nonbasic variable's reduced cost, d_j = c_j − yᵀ a_j. */
  private computeDual(): Float64Array {
    const y = new Float64Array(this.m);
    for (let i = 0; i < this.m; i++) y[i] = this.cost[this.head[i]!]!;
    this.factor.btran(y);
    for (let j = 0; j < this.N; j++) this.d[j] = this.kind[j] === BASIC ? 0 : this.cost[j]! - this.dot(j, y);
    return y;
  }

  /** Puts nonbasic variable j at the bound its reduced cost allows, or on an artificial bound. */
  private place(j: number): void {
    const lo = this.lo[j]!;
    const up = this.up[j]!;
    const dj = this.d[j]!;
    const tol = this.opts.dualTol;
    this.art[j] = 0;
    if (lo === up) {
      this.kind[j] = FIXED;
      this.x[j] = lo;
    } else if (dj > tol || (dj >= -tol && lo > -Infinity)) {
      if (lo > -Infinity) {
        this.kind[j] = AT_LOWER;
        this.x[j] = lo;
      } else if (dj <= tol && up < Infinity) {
        this.kind[j] = AT_UPPER;
        this.x[j] = up;
      } else if (dj <= tol) {
        this.kind[j] = FREE;
        this.x[j] = 0;
      } else {
        this.kind[j] = AT_LOWER;
        this.art[j] = -1;
        this.x[j] = -this.box;
      }
    } else if (up < Infinity) {
      this.kind[j] = AT_UPPER;
      this.x[j] = up;
    } else if (dj >= -tol) {
      this.kind[j] = FREE;
      this.x[j] = 0;
    } else {
      this.kind[j] = AT_UPPER;
      this.art[j] = 1;
      this.x[j] = this.box;
    }
  }

  /**
   * Repairs nonbasic reduced costs whose sign rounding has made wrong: a variable with both bounds finite moves to its
   * other bound; any other has its cost shifted, to be removed at the end. Returns whether any variable moved.
   */
  private repairDual(): boolean {
    const tol = this.opts.dualTol;
    let moved = false;
    for (let j = 0; j < this.N; j++) {
      const k = this.kind[j]!;
      const dj = this.d[j]!;
      const wrong = (k === AT_LOWER && dj < -tol) || (k === AT_UPPER && dj > tol) || (k === FREE && Math.abs(dj) > tol);
      if (!wrong) continue;
      if (this.art[j] === 0 && this.lo[j]! > -Infinity && this.up[j]! < Infinity && k !== FREE) {
        this.kind[j] = k === AT_LOWER ? AT_UPPER : AT_LOWER;
        this.x[j] = k === AT_LOWER ? this.up[j]! : this.lo[j]!;
        moved = true;
      } else {
        this.shift[j]! -= dj;
        this.cost[j]! -= dj;
        this.d[j] = 0;
      }
    }
    return moved;
  }

  /** Refactors, then recomputes the primal values and reduced costs from scratch. False if the basis is singular. */
  private reinvert(): boolean {
    if (!this.refactor()) return false;
    this.computeDual();
    // Variables repairDual() moves change the primal values, not the duals, so the primal values come after.
    this.repairDual();
    this.computePrimal();
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------
  // The method

  run(): SimplexResult {
    const { m, N } = this;
    // The logicals are the first basis, unless a warm start gives another; every other variable starts nonbasic
    // (placed below, once its reduced cost is known).
    const warm = this.warmStart();
    this.kind.fill(FREE);
    for (let i = 0; i < m; i++) this.kind[this.head[i]!] = BASIC;
    if (!this.refactor()) {
      if (!warm) return this.finish(4);
      // A singular warm start: start from the logicals after all.
      for (let i = 0; i < m; i++) this.head[i] = this.n + i;
      this.kind.fill(FREE);
      for (let i = 0; i < m; i++) this.kind[this.head[i]!] = BASIC;
      if (!this.refactor()) return this.finish(4);
    }
    this.computeDual();
    for (let j = 0; j < N; j++) if (this.kind[j] !== BASIC) this.place(j);
    this.computePrimal();

    // Rounds after optimality (removing cost shifts, leaving artificial bounds) are few; a bound stops a loop.
    for (let round = 0; ; round++) {
      if (round > 50) return this.finish(4);
      const status = this.iterate();
      if (status !== 0) return this.finish(status);
      // Optimal for the boxed problem with shifted costs: remove the shifts, then deal with artificial bounds.
      if (this.unshift()) continue;
      const box = this.leaveArtificial();
      if (box === 'moved') continue;
      if (box === 'grow') {
        if (!this.growBox()) return this.finish(3);
        continue;
      }
      return this.finish(0);
    }
  }

  /** Takes the warm start's basis into `head`, if it is m distinct variables. Returns whether it did. */
  private warmStart(): boolean {
    const basis = this.opts.basis;
    if (!basis || basis.length !== this.m) return false;
    const seen = new Uint8Array(this.N);
    for (let i = 0; i < this.m; i++) {
      const j = basis[i]!;
      if (!Number.isInteger(j) || j < 0 || j >= this.N || seen[j]) return false;
      seen[j] = 1;
    }
    for (let i = 0; i < this.m; i++) this.head[i] = basis[i]!;
    return true;
  }

  /** Dual simplex iterations until the basic variables are within their bounds. 0 when they are. */
  private iterate(): Status {
    const { m, N } = this;
    const ptol = this.opts.primalTol;
    const dtol = this.opts.dualTol;
    const alphaRow = new Float64Array(N);
    for (;;) {
      if (this.factor.updates >= REFACTOR && !this.reinvert()) return 4;

      // Pricing, by dual steepest edge: of the basic variables outside their bounds, the largest infeasibility² over
      // its row's weight leaves.
      let r = -1;
      let worst = 0;
      for (let i = 0; i < m; i++) {
        const p = this.head[i]!;
        const v = this.x[p]!;
        const inf = v < this.lo[p]! ? this.lo[p]! - v : v > this.up[p]! ? v - this.up[p]! : 0;
        if (inf <= ptol) continue;
        const score = (inf * inf) / this.weight[i]!;
        if (score > worst) {
          worst = score;
          r = i;
        }
      }
      if (r < 0) return 0;
      if (this.nit >= this.opts.maxIter) return 1;

      const p = this.head[r]!;
      const toLower = this.x[p]! < this.lo[p]!;
      const target = toLower ? this.lo[p]! : this.up[p]!;
      const s = toLower ? 1 : -1;

      // The pivot row: ρ = B⁻ᵀ e_r, and α_rj = ρᵀ a_j for every nonbasic j.
      const rho = new Float64Array(m);
      rho[r] = 1;
      this.factor.btran(rho);
      for (let j = 0; j < N; j++) alphaRow[j] = this.kind[j] === BASIC ? 0 : this.dot(j, rho);

      // The ratio test. With α̂_j = s α_rj, d_j becomes d_j + t α̂_j as the dual step t grows; candidate j's breakpoint
      // is where d_j would change sign.
      const cand: { j: number; a: number; ratio: number; harris: number }[] = [];
      for (let j = 0; j < N; j++) {
        const k = this.kind[j]!;
        if (k === BASIC || k === FIXED) continue;
        const a = s * alphaRow[j]!;
        let dj: number;
        if (k === AT_LOWER && a < -PIVOT_TOL) dj = Math.max(this.d[j]!, 0);
        else if (k === AT_UPPER && a > PIVOT_TOL) dj = Math.max(-this.d[j]!, 0);
        else if (k === FREE && Math.abs(a) > PIVOT_TOL) dj = Math.abs(this.d[j]!);
        else continue;
        const abs = Math.abs(a);
        cand.push({ j, a: abs, ratio: dj / abs, harris: (dj + dtol) / abs });
      }
      if (cand.length === 0) {
        // A dual ray: infeasible, unless the ray leans on an artificial bound.
        if (this.rayUsesBox(alphaRow, s)) {
          if (!this.growBox()) return 2;
          continue;
        }
        return 2;
      }
      cand.sort((u, v) => u.ratio - v.ratio);

      // Bound flipping (Koberstein's long-step test): the dual objective keeps rising past a boxed variable's
      // breakpoint while the slope, the leaving variable's infeasibility less |α̂_j| × (u_j − l_j) for each one passed,
      // stays positive. The variables passed flip to their other bound instead of entering.
      let slope = Math.abs(this.x[p]! - target);
      let k = 0;
      for (; k < cand.length - 1; k++) {
        const j = cand[k]!.j;
        if (this.art[j] !== 0 || this.kind[j] === FREE || !(this.lo[j]! > -Infinity && this.up[j]! < Infinity)) break;
        const drop = cand[k]!.a * (this.up[j]! - this.lo[j]!);
        if (slope - drop < 0) break;
        slope -= drop;
      }

      // Harris's two passes over the rest: the largest pivot among the breakpoints within the tolerance of the first.
      let bound = Infinity;
      for (let i = k; i < cand.length; i++) bound = Math.min(bound, cand[i]!.harris);
      let chosen = k;
      for (let i = k; i < cand.length && cand[i]!.ratio <= bound; i++) if (cand[i]!.a > cand[chosen]!.a) chosen = i;
      const q = cand[chosen]!.j;
      const t = cand[chosen]!.ratio;
      const flips = cand.slice(0, k).map((c) => c.j);

      // The entering column, and a check that it agrees with the pivot row.
      const alphaQ = new Float64Array(m);
      this.addColumn(q, 1, alphaQ);
      this.factor.ftran(alphaQ);
      const arq = alphaQ[r]!;
      if (Math.abs(arq - alphaRow[q]!) > 1e-7 * (1 + Math.abs(arq))) {
        // The factorization has drifted: start again from a fresh one.
        if (this.factor.updates === 0 || !this.reinvert()) return 4;
        continue;
      }

      // The flips: each flipped variable moves to its other bound, and x_B by −B⁻¹ a_j Δ_j.
      if (flips.length) {
        const delta = new Float64Array(m);
        for (const j of flips) {
          const toUpper = this.kind[j] === AT_LOWER;
          const step = toUpper ? this.up[j]! - this.lo[j]! : this.lo[j]! - this.up[j]!;
          this.kind[j] = toUpper ? AT_UPPER : AT_LOWER;
          this.x[j] = toUpper ? this.up[j]! : this.lo[j]!;
          this.addColumn(j, step, delta);
        }
        this.factor.ftran(delta);
        for (let i = 0; i < m; i++) this.x[this.head[i]!]! -= delta[i]!;
      }

      // The primal step: x_q moves by θ, x_B by −θ α_q, and x_p lands on its bound.
      const theta = (this.x[p]! - target) / arq;
      for (let i = 0; i < m; i++) this.x[this.head[i]!]! -= theta * alphaQ[i]!;
      this.x[q]! += theta;
      this.x[p] = target;

      // The dual step: d_j += s t α_rj, and the leaving variable's reduced cost is s t.
      for (let j = 0; j < N; j++) if (this.kind[j] !== BASIC && j !== q) this.d[j]! += s * t * alphaRow[j]!;
      this.d[q] = 0;
      this.d[p] = s * t;

      // The steepest edge weights for the new basis: τ = B⁻¹ ρ, then w_r' = w_r / α_rq² and, for every other row,
      // w_i' = w_i − 2 (α_iq / α_rq) τ_i + (α_iq / α_rq)² w_r, kept above a small floor against rounding.
      const tau = this.factor.ftran(rho.slice());
      const wr = this.weight[r]!;
      for (let i = 0; i < m; i++) {
        if (i === r) continue;
        const ratio = alphaQ[i]! / arq;
        if (ratio === 0) continue;
        this.weight[i] = Math.max(this.weight[i]! - 2 * ratio * tau[i]! + ratio * ratio * wr, 1e-4);
      }
      this.weight[r] = Math.max(wr / (arq * arq), 1e-4);

      // The change of basis.
      this.head[r] = q;
      this.kind[q] = BASIC;
      this.art[q] = 0;
      this.kind[p] = this.lo[p] === this.up[p] ? FIXED : toLower ? AT_LOWER : AT_UPPER;
      this.art[p] = 0;
      this.factor.update(r, alphaQ);
      this.nit++;
    }
  }

  /** Whether a dual ray needs an artificial bound: a variable on one, whose reduced cost the ray moves off zero. */
  private rayUsesBox(alphaRow: Float64Array, s: number): boolean {
    for (let j = 0; j < this.N; j++) {
      if (this.art[j] === 0) continue;
      const a = s * alphaRow[j]!;
      if ((this.art[j] === -1 && a > PIVOT_TOL) || (this.art[j] === 1 && a < -PIVOT_TOL)) return true;
    }
    return false;
  }

  /** Grows the artificial bounds a thousandfold, moving every variable on one. False past the limit. */
  private growBox(): boolean {
    this.box *= 1e3;
    if (this.box > BOX_LIMIT) return false;
    for (let j = 0; j < this.N; j++) if (this.art[j] !== 0) this.x[j] = this.art[j]! * this.box;
    this.computePrimal();
    return true;
  }

  /**
   * Removes the cost shifts, and recomputes. Returns whether iterations must continue: a reduced cost that now has the
   * wrong sign is repaired by moving its variable to its other bound, which breaks primal feasibility.
   */
  private unshift(): boolean {
    let any = false;
    for (let j = 0; j < this.N; j++) {
      if (this.shift[j] !== 0) {
        this.cost[j]! -= this.shift[j]!;
        this.shift[j] = 0;
        any = true;
      }
    }
    if (!any) return false;
    if (!this.reinvert()) return false;
    // reinvert() repaired any wrong signs: by moving variables (primal infeasibility, so iterate again), or by
    // shifting costs once more, which the next pass removes.
    return true;
  }

  /**
   * Variables still on an artificial bound at the end. One whose reduced cost isn't zero shows the box was too small
   * ('grow'). One whose reduced cost is zero moves toward 0 at no cost, until it reaches 0 (or its finite bound) or a
   * basic variable reaches a bound, which it then replaces in the basis ('moved'). 'done' when none is left.
   */
  private leaveArtificial(): 'grow' | 'moved' | 'done' {
    const { m, N } = this;
    const dtol = this.opts.dualTol;
    let moved = false;
    for (let j = 0; j < N; j++) {
      if (this.art[j] === 0) continue;
      if (Math.abs(this.d[j]!) > dtol) return 'grow';
    }
    for (let j = 0; j < N; j++) {
      if (this.art[j] === 0) continue;
      const goal = Math.min(Math.max(0, this.lo[j]!), this.up[j]!);
      const dir = goal > this.x[j]! ? 1 : -1;
      const alpha = new Float64Array(m);
      this.addColumn(j, 1, alpha);
      this.factor.ftran(alpha);
      // x_B changes by −dir·θ·α as x_j moves by dir·θ.
      let step = Math.abs(goal - this.x[j]!);
      let r = -1;
      let rTarget = 0;
      for (let i = 0; i < m; i++) {
        const v = -dir * alpha[i]!;
        if (Math.abs(v) <= PIVOT_TOL) continue;
        const b = this.head[i]!;
        const limit = v > 0 ? this.up[b]! : this.lo[b]!;
        if (!Number.isFinite(limit)) continue;
        const room = Math.max((limit - this.x[b]!) / v, 0);
        if (room < step) {
          step = room;
          r = i;
          rTarget = limit;
        }
      }
      for (let i = 0; i < m; i++) this.x[this.head[i]!]! -= dir * step * alpha[i]!;
      this.x[j]! += dir * step;
      this.art[j] = 0;
      if (r < 0) {
        this.x[j] = goal;
        this.kind[j] = goal === this.lo[j] ? (this.lo[j] === this.up[j] ? FIXED : AT_LOWER) : goal === this.up[j] ? AT_UPPER : FREE;
      } else {
        const b = this.head[r]!;
        this.x[b] = rTarget;
        this.head[r] = j;
        this.kind[j] = BASIC;
        this.kind[b] = this.lo[b] === this.up[b] ? FIXED : rTarget === this.lo[b] ? AT_LOWER : AT_UPPER;
        this.factor.update(r, alpha);
        // The weight is a guide to pricing, not part of the answer: start this row's again from 1.
        this.weight[r] = 1;
      }
      moved = true;
    }
    if (!moved) return 'done';
    // The reduced costs change little (the moved variables' were 0); recompute them and repair any wrong sign.
    if (!this.reinvert()) return 'done';
    return 'moved';
  }

  private finish(status: Status): SimplexResult {
    if (status === 0) {
      // Fresh values from a fresh factorization, so the result doesn't carry the updates' rounding.
      if (this.refactor()) {
        this.computePrimal();
        this.computeDual();
      }
    }
    const at = new Int8Array(this.N);
    for (let j = 0; j < this.N; j++) at[j] = this.kind[j] === AT_LOWER ? -1 : this.kind[j] === AT_UPPER ? 1 : 0;
    for (let j = 0; j < this.N; j++) {
      if (this.kind[j] === FIXED) at[j] = this.d[j]! >= 0 ? -1 : 1;
    }
    return { status, nit: this.nit, x: this.x, d: this.d, at, basis: status === 0 ? this.head.slice() : null };
  }
}

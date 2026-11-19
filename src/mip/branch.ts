/**
 * Branch-and-bound for mixed-integer linear programs (smaltworks ADR 0039, section 1, phase 2): the LP relaxation of
 * each node solved by smaltlp's dual simplex, the tree searched depth first until a first integer solution, then best
 * bound first, and nodes pruned by the incumbent and the gap.
 *
 * A node is the original problem with tighter bounds on its integer columns. Its relaxation's value bounds every
 * solution below it. Where the relaxation's solution has an integer column off a whole number (by more than
 * INT_TOL), the node branches on the most fractional one, x_j = v: one child has x_j ≤ ⌊v⌋, the other x_j ≥ ⌈v⌉.
 * The child on the side v is nearer to is searched first.
 *
 * The root is solved with presolve when it is on; every other node starts the dual simplex from its parent's optimal
 * basis (a warm start). Branching changes only bounds, so that basis is still dual feasible, and the dual simplex
 * needs only the few changes of basis the new bound forces. Written from the textbook method (Land and Doig, Econometrica, 1960; Wolsey, Integer Programming, 2020), not from any
 * solver's code.
 * @module
 */
import { solve } from '../lp/presolve.ts';
import type { BasisFactor } from '../core/basis.ts';
import { dualSimplex, type Lp } from '../lp/simplex.ts';

/** How far an integer column's value may be from a whole number and still count as integral: HiGHS's default. */
export const INT_TOL = 1e-6;
/** The absolute gap at which the search stops: HiGHS's default. */
export const ABS_GAP = 1e-6;

export interface BranchOptions {
  /** 1 for each integer column, 0 for a continuous one. */
  integer: Uint8Array;
  /** The relative gap at which the search stops: (incumbent − bound) / |incumbent|. */
  relGap: number;
  /** The most nodes to solve. */
  nodeLimit: number;
  /** The most seconds to spend. */
  timeLimit: number;
  presolve: boolean;
  /** The simplex's primal and dual tolerance. */
  tol: number;
  /** The most simplex iterations at each node. */
  maxIter: number;
  /** Start each node from its parent's basis. Default true; false solves every node from the start. */
  warmStart?: boolean;
}

/**
 * How the search ended:
 * - `optimal`: the incumbent is optimal, within the gap;
 * - `infeasible`: no integer solution exists;
 * - `unboundedOrInfeasible`: the root relaxation is unbounded, so the problem is unbounded if it has a solution;
 * - `nodeLimit`, `timeLimit`: a limit stopped the search, with or without an incumbent;
 * - `numerical`: a node's relaxation failed (numerical trouble or its iteration limit).
 */
export type BranchEnd = 'optimal' | 'infeasible' | 'unboundedOrInfeasible' | 'nodeLimit' | 'timeLimit' | 'numerical';

export interface BranchResult {
  end: BranchEnd;
  /** The best integer solution found (the n columns), or null. Integer columns are whole numbers. */
  x: Float64Array | null;
  /** cᵀx for x, or null. */
  objective: number | null;
  /** The lowest bound on the optimum: the incumbent's value when the search finished, -Infinity before any bound. */
  dualBound: number;
  /** (objective − dualBound) / |objective|; 0 when they are equal, Infinity without an incumbent. */
  gap: number;
  /** Nodes solved. */
  nodes: number;
  /** Simplex iterations, over every node. */
  nit: number;
}

interface Node {
  colLo: Float64Array;
  colUp: Float64Array;
  /** The parent's relaxation value: a lower bound on this node's. */
  bound: number;
  /** The parent's optimal basis, to start from; null at the root. */
  basis: Int32Array | null;
  /** Its factorization, when the parent's solve gave one; the child's solve starts from a copy. */
  factor: BasisFactor | null;
}

/** Minimizes cᵀx over lp, with the columns marked integer taking whole values. */
export function branchAndBound(lp: Lp, opts: BranchOptions): BranchResult {
  const start = performance.now();
  const n = lp.A.cols;
  const { integer } = opts;
  // Integer columns' bounds, rounded inward.
  const colLo = lp.colLo.slice();
  const colUp = lp.colUp.slice();
  for (let j = 0; j < n; j++) {
    if (!integer[j]) continue;
    colLo[j] = Math.ceil(colLo[j]! - INT_TOL);
    colUp[j] = Math.floor(colUp[j]! + INT_TOL);
  }

  let x: Float64Array | null = null;
  let objective = Infinity;
  let nodes = 0;
  let nit = 0;
  const open: Node[] = [{ colLo, colUp, bound: -Infinity, basis: null, factor: null }];
  const warm = opts.warmStart ?? true;
  const result = (end: BranchEnd): BranchResult => {
    let dualBound = x ? objective : Infinity;
    for (const node of open) dualBound = Math.min(dualBound, node.bound);
    if (end === 'optimal' || end === 'infeasible') open.length = 0;
    if (end === 'optimal') dualBound = Math.min(dualBound, objective);
    if (end === 'infeasible') dualBound = Infinity;
    const gap = !x ? Infinity : objective === dualBound ? 0 : Math.abs(objective - dualBound) / Math.abs(objective);
    return { end, x, objective: x ? objective : null, dualBound, gap, nodes, nit };
  };
  /** Whether a bound is close enough to the incumbent that nothing below it is worth searching. */
  const pruned = (bound: number): boolean =>
    x !== null && (bound >= objective - ABS_GAP || bound >= objective - opts.relGap * Math.abs(objective));

  while (open.length > 0) {
    if (nodes >= opts.nodeLimit) return result('nodeLimit');
    if ((performance.now() - start) / 1000 >= opts.timeLimit) return result('timeLimit');
    // Depth first until an incumbent, then the open node with the lowest bound.
    let pick = open.length - 1;
    if (x) for (let k = 0; k < open.length; k++) if (open[k]!.bound < open[pick]!.bound) pick = k;
    const node = open[pick]!;
    open[pick] = open[open.length - 1]!;
    open.pop();
    if (pruned(node.bound)) continue;

    let empty = false;
    for (let j = 0; j < n && !empty; j++) if (node.colLo[j]! > node.colUp[j]!) empty = true;
    if (empty) continue;
    const nodeLp = { ...lp, colLo: node.colLo, colUp: node.colUp };
    const simplex = { maxIter: opts.maxIter, primalTol: opts.tol, dualTol: opts.tol };
    // The root with presolve (if on); below it, the dual simplex from the parent's basis.
    const res = node.basis && warm ? dualSimplex(nodeLp, { ...simplex, basis: node.basis, refactorAtEnd: false, ...(node.factor ? { factor: node.factor } : {}) }) : solve(nodeLp, { ...simplex, presolve: opts.presolve && (nodes === 0 || !warm) });
    nodes++;
    nit += res.nit;
    if (res.status === 2) continue;
    if (res.status === 3) {
      // Tighter bounds can't make a bounded relaxation unbounded, so this is the root.
      return result('unboundedOrInfeasible');
    }
    if (res.status !== 0) {
      open.push(node);
      return result('numerical');
    }
    let value = 0;
    for (let j = 0; j < n; j++) value += lp.c[j]! * res.x[j]!;
    if (pruned(value)) continue;

    // The most fractional integer column, the lowest index among ties.
    let branch = -1;
    let most = INT_TOL;
    for (let j = 0; j < n; j++) {
      if (!integer[j]) continue;
      const v = res.x[j]!;
      const f = Math.abs(v - Math.round(v));
      if (f > most) {
        most = f;
        branch = j;
      }
    }
    if (branch < 0) {
      // Integral: a new incumbent, with its integer columns made whole.
      const sol = res.x.slice(0, n);
      for (let j = 0; j < n; j++) if (integer[j]) sol[j] = Math.round(sol[j]!) + 0;
      let obj = 0;
      for (let j = 0; j < n; j++) obj += lp.c[j]! * sol[j]!;
      if (obj < objective) {
        x = sol;
        objective = obj;
      }
      continue;
    }
    const v = res.x[branch]!;
    const down: Node = { colLo: node.colLo, colUp: node.colUp.slice(), bound: value, basis: res.basis, factor: res.factor };
    down.colUp[branch] = Math.floor(v);
    const up: Node = { colLo: node.colLo.slice(), colUp: node.colUp, bound: value, basis: res.basis, factor: res.factor };
    up.colLo[branch] = Math.ceil(v);
    // The nearer side last, so depth-first search takes it next.
    if (v - Math.floor(v) < 0.5) open.push(up, down);
    else open.push(down, up);
  }
  return result(x ? 'optimal' : 'infeasible');
}

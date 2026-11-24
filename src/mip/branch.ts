/**
 * Branch-and-bound for mixed-integer linear programs (smaltworks ADR 0039, section 1, phase 2): the LP relaxation of
 * each node solved by smaltlp's dual simplex, the tree searched depth first until a first integer solution, then best
 * bound first, and nodes pruned by the incumbent and the gap.
 *
 * A node is the original problem with tighter bounds on its integer columns. Its relaxation's value bounds every
 * solution below it. Where the relaxation's solution has integer columns off a whole number (by more than INT_TOL),
 * the node branches on one of them, x_j = v: one child has x_j ≤ ⌊v⌋, the other x_j ≥ ⌈v⌉. The child on the side v
 * is nearer to is searched first.
 *
 * Which column: reliability branching (Achterberg, Koch and Martin, Operations Research Letters, 2005), by default.
 * Each column's pseudocosts are the gains in the relaxation's value per unit its value moved, down and up, averaged
 * over the children solved so far. A column's score is the product of its expected gains, down and up (each at least
 * SCORE_EPS). Where a candidate has fewer than RELIABLE observations on a side, its two children are solved there and
 * then (strong branching, from the node's basis) and their gains are recorded; the candidates are tried best score
 * first, and the search stops after LOOKAHEAD in a row that don't improve on the best. A child found infeasible, or
 * no better than the incumbent, needs no search, so a column with one is taken at once; the chosen column's children,
 * when solved this way, are kept and not solved again. `branching: 'mostFractional'` takes the most fractional column
 * instead, as smaltlp did before.
 *
 * The root is solved with presolve when it is on; every other node starts the dual simplex from its parent's optimal
 * basis (a warm start). Branching changes only bounds, so that basis is still dual feasible, and the dual simplex
 * needs only the few changes of basis the new bound forces. Written from the textbook method (Land and Doig, Econometrica, 1960; Wolsey, Integer Programming, 2020), not from any
 * solver's code.
 * @module
 */
import { solve } from '../lp/presolve.ts';
import type { BasisFactor } from '../core/basis.ts';
import { dualSimplex, type Lp, type SimplexResult } from '../lp/simplex.ts';

/** How far an integer column's value may be from a whole number and still count as integral: HiGHS's default. */
export const INT_TOL = 1e-6;
/** The absolute gap at which the search stops: HiGHS's default. */
export const ABS_GAP = 1e-6;
/** Observations on each side, down and up, after which a column's pseudocosts are trusted without strong branching. */
export const RELIABLE = 4;
/** Candidates in a row without a better score, after which reliability branching stops looking. */
export const LOOKAHEAD = 4;
/** The least expected gain a side counts for in a score, so one side of 0 doesn't hide the other. */
const SCORE_EPS = 1e-6;

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
  /** How the column to branch on is chosen: 'reliability' (the default) or 'mostFractional'. */
  branching?: 'reliability' | 'mostFractional';
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
  /** Simplex iterations, over every node and every strong branching solve. */
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
  /** The column branched on to make this node (-1 at the root), which way (0 down, 1 up), and by how much it moved. */
  column: number;
  side: number;
  moved: number;
  /** The node's relaxation, when strong branching has solved it already. */
  solved: SimplexResult | null;
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
  const open: Node[] = [{ colLo, colUp, bound: -Infinity, basis: null, factor: null, column: -1, side: 0, moved: 0, solved: null }];
  const warm = opts.warmStart ?? true;
  const reliability = (opts.branching ?? 'reliability') === 'reliability';
  // Pseudocosts: for each column and side (down at j, up at n + j), the sum of the gains per unit moved, and how many.
  const pcSum = new Float64Array(2 * n);
  const pcCount = new Int32Array(2 * n);
  const pcTotal = [0, 0];
  const pcTotalCount = [0, 0];
  const observe = (j: number, side: number, gain: number, moved: number): void => {
    const unit = Math.max(gain, 0) / moved;
    pcSum[side * n + j]! += unit;
    pcCount[side * n + j]!++;
    pcTotal[side]! += unit;
    pcTotalCount[side]!++;
  };
  /** The expected gain per unit on a side: the column's average, else every column's, else 1. */
  const pseudocost = (j: number, side: number): number => {
    const k = side * n + j;
    if (pcCount[k]! > 0) return pcSum[k]! / pcCount[k]!;
    return pcTotalCount[side]! > 0 ? pcTotal[side]! / pcTotalCount[side]! : 1;
  };
  const score = (down: number, up: number): number => Math.max(down, SCORE_EPS) * Math.max(up, SCORE_EPS);
  const simplex = { maxIter: opts.maxIter, primalTol: opts.tol, dualTol: opts.tol };
  const objectiveOf = (x: Float64Array): number => {
    let value = 0;
    for (let j = 0; j < n; j++) value += lp.c[j]! * x[j]!;
    return value;
  };
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
    // The root with presolve (if on); below it, the dual simplex from the parent's basis, unless strong branching has
    // solved this node already.
    let res: SimplexResult;
    if (node.solved) res = node.solved;
    else {
      res = node.basis && warm ? dualSimplex(nodeLp, { ...simplex, basis: node.basis, refactorAtEnd: false, ...(node.factor ? { factor: node.factor } : {}) }) : solve(nodeLp, { ...simplex, presolve: opts.presolve && (nodes === 0 || !warm) });
      nit += res.nit;
    }
    nodes++;
    if (res.status === 2) continue;
    if (res.status === 3) {
      // Tighter bounds can't make a bounded relaxation unbounded, so this is the root.
      return result('unboundedOrInfeasible');
    }
    if (res.status !== 0) {
      open.push(node);
      return result('numerical');
    }
    const value = objectiveOf(res.x);
    // What this node shows of the column branched on to make it.
    if (node.column >= 0 && !node.solved && Number.isFinite(node.bound)) observe(node.column, node.side, value - node.bound, node.moved);
    if (pruned(value)) continue;

    // The integer columns off a whole number.
    const fractional: number[] = [];
    for (let j = 0; j < n; j++) {
      if (!integer[j]) continue;
      const v = res.x[j]!;
      if (Math.abs(v - Math.round(v)) > INT_TOL) fractional.push(j);
    }
    let branch = -1;
    // The children strong branching solved for the chosen column, if it did.
    let downSolved: SimplexResult | null = null;
    let upSolved: SimplexResult | null = null;
    let downBound = value;
    let upBound = value;
    if (fractional.length > 0 && !reliability) {
      // The most fractional, the lowest index among ties.
      let most = INT_TOL;
      for (const j of fractional) {
        const f = Math.abs(res.x[j]! - Math.round(res.x[j]!));
        if (f > most) {
          most = f;
          branch = j;
        }
      }
    } else if (fractional.length > 0) {
      // Reliability branching: the candidates by their pseudocost scores, best first (the lowest index among ties).
      const scored = fractional.map((j) => {
        const f = res.x[j]! - Math.floor(res.x[j]!);
        return { j, f, score: score(pseudocost(j, 0) * f, pseudocost(j, 1) * (1 - f)) };
      });
      scored.sort((a, b) => b.score - a.score || a.j - b.j);
      let best = -Infinity;
      let since = 0;
      /** Solves one child of this node with x_j's bound moved; its result, and the value it gives (Infinity if none). */
      const child = (j: number, side: number): { res: SimplexResult; value: number } => {
        const lo = side === 0 ? node.colLo : node.colLo.slice();
        const up = side === 0 ? node.colUp.slice() : node.colUp;
        if (side === 0) up[j] = Math.floor(res.x[j]!);
        else lo[j] = Math.ceil(res.x[j]!);
        const r = dualSimplex({ ...lp, colLo: lo, colUp: up }, { ...simplex, basis: res.basis!, refactorAtEnd: false, ...(res.factor ? { factor: res.factor } : {}) });
        nit += r.nit;
        return { res: r, value: r.status === 0 ? objectiveOf(r.x) : r.status === 2 ? Infinity : NaN };
      };
      for (const { j, f, score: estimate } of scored) {
        let s = estimate;
        let down: { res: SimplexResult; value: number } | null = null;
        let up: { res: SimplexResult; value: number } | null = null;
        const reliable = pcCount[j]! >= RELIABLE && pcCount[n + j]! >= RELIABLE;
        if (!reliable && res.basis) {
          down = child(j, 0);
          up = child(j, 1);
          // A solve that failed (numerical trouble, its iteration limit) tells nothing: its pseudocost stands.
          if (Number.isFinite(down.value)) observe(j, 0, down.value - value, f);
          if (Number.isFinite(up.value)) observe(j, 1, up.value - value, 1 - f);
          const deadDown = down.value === Infinity || (Number.isFinite(down.value) && pruned(down.value));
          const deadUp = up.value === Infinity || (Number.isFinite(up.value) && pruned(up.value));
          if (deadDown || deadUp) {
            // One side needs no search (or neither does, and the node is done): this column, at once.
            branch = j;
            downSolved = down.res;
            upSolved = up.res;
            downBound = Number.isFinite(down.value) ? down.value : value;
            upBound = Number.isFinite(up.value) ? up.value : value;
            break;
          }
          if (Number.isFinite(down.value) && Number.isFinite(up.value)) s = score(down.value - value, up.value - value);
        }
        if (s > best) {
          best = s;
          since = 0;
          branch = j;
          downSolved = down && Number.isFinite(down.value) ? down.res : null;
          upSolved = up && Number.isFinite(up.value) ? up.res : null;
          downBound = down && Number.isFinite(down.value) ? down.value : value;
          upBound = up && Number.isFinite(up.value) ? up.value : value;
        } else if (++since >= LOOKAHEAD) break;
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
    const f = v - Math.floor(v);
    const down: Node = { colLo: node.colLo, colUp: node.colUp.slice(), bound: downBound, basis: res.basis, factor: res.factor, column: branch, side: 0, moved: f, solved: downSolved };
    down.colUp[branch] = Math.floor(v);
    const up: Node = { colLo: node.colLo.slice(), colUp: node.colUp, bound: upBound, basis: res.basis, factor: res.factor, column: branch, side: 1, moved: 1 - f, solved: upSolved };
    up.colLo[branch] = Math.ceil(v);
    // The nearer side last, so depth-first search takes it next.
    if (v - Math.floor(v) < 0.5) open.push(up, down);
    else open.push(down, up);
  }
  return result(x ? 'optimal' : 'infeasible');
}

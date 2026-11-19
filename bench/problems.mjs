// The integer programs bench/warm.mjs times branch-and-bound on, from seeded generators. Each takes the dist/ to
// build from, so the same problems can be timed on an older build (SMALTLP_DIST).
//   import { MIPS } from './problems.mjs'
//
// - Multi-dimensional knapsacks: m rows of whole weights 1 to 30, each row's capacity half its total, and n binary
//   items worth 1 to 40.
// - Capacitated facility location: F facilities and K customers at random points in a 100 × 100 square. Each customer
//   has a demand of 5 to 34; each facility a capacity of 15% to 40% of the total demand and a fixed cost of 400 to
//   1,199 to open (a binary y_f). Shipping x_fk costs a hundredth of the distance per unit. Every demand is met
//   (Σ_f x_fk = d_k), and a facility ships only if open, within its capacity (Σ_k x_fk ≤ C_f y_f).

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** A multi-dimensional knapsack, as a minimization: max worth·x is min −worth·x. */
function knapsack(fromTriplets, m, n, seed) {
  const r = rng(seed);
  const ii = [];
  const jj = [];
  const vv = [];
  const rowUp = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const a = 1 + Math.floor(r() * 30);
      ii.push(i);
      jj.push(j);
      vv.push(a);
      sum += a;
    }
    rowUp[i] = Math.floor(sum / 2);
  }
  const c = Float64Array.from({ length: n }, () => -(1 + Math.floor(r() * 40)));
  const lp = { A: fromTriplets(m, n, ii, jj, vv), c, colLo: new Float64Array(n), colUp: new Float64Array(n).fill(1), rowLo: new Float64Array(m).fill(-Infinity), rowUp };
  return { lp, integer: new Uint8Array(n).fill(1) };
}

/** A capacitated facility location problem: the F facilities' y_f, then the shipments x_fk, facility by facility. */
function facility(fromTriplets, F, K, seed) {
  const r = rng(seed);
  const at = Array.from({ length: F }, () => [r() * 100, r() * 100]);
  const to = Array.from({ length: K }, () => [r() * 100, r() * 100]);
  const demand = to.map(() => 5 + Math.floor(r() * 30));
  const total = demand.reduce((a, b) => a + b, 0);
  const capacity = at.map(() => Math.round(total * (0.15 + r() * 0.25)));
  const fixed = at.map(() => 400 + Math.floor(r() * 800));
  const n = F + F * K;
  const x = (f, k) => F + f * K + k;
  const c = new Float64Array(n);
  for (let f = 0; f < F; f++) c[f] = fixed[f];
  for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) c[x(f, k)] = Math.round(Math.hypot(at[f][0] - to[k][0], at[f][1] - to[k][1]) * 10) / 100;
  const ii = [];
  const jj = [];
  const vv = [];
  for (let k = 0; k < K; k++) for (let f = 0; f < F; f++) (ii.push(k), jj.push(x(f, k)), vv.push(1));
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < K; k++) (ii.push(K + f), jj.push(x(f, k)), vv.push(1));
    ii.push(K + f);
    jj.push(f);
    vv.push(-capacity[f]);
  }
  const m = K + F;
  const rowLo = new Float64Array(m);
  const rowUp = new Float64Array(m);
  for (let k = 0; k < K; k++) rowLo[k] = rowUp[k] = demand[k];
  for (let f = 0; f < F; f++) (rowLo[K + f] = -Infinity), (rowUp[K + f] = 0);
  const colUp = new Float64Array(n).fill(Infinity);
  for (let f = 0; f < F; f++) colUp[f] = 1;
  const integer = new Uint8Array(n);
  integer.fill(1, 0, F);
  return { lp: { A: fromTriplets(m, n, ii, jj, vv), c, colLo: new Float64Array(n), colUp, rowLo, rowUp }, integer };
}

/** The problems, by name, each made on demand with the given build's fromTriplets. */
export const MIPS = [
  { key: 'knapsack-10x30', kind: 'knapsack', rows: 10, cols: 30, make: (t) => knapsack(t, 10, 30, 10030) },
  { key: 'knapsack-15x50', kind: 'knapsack', rows: 15, cols: 50, make: (t) => knapsack(t, 15, 50, 15050) },
  { key: 'knapsack-20x60', kind: 'knapsack', rows: 20, cols: 60, make: (t) => knapsack(t, 20, 60, 20060) },
  { key: 'knapsack-30x80', kind: 'knapsack', rows: 30, cols: 80, make: (t) => knapsack(t, 30, 80, 30080) },
  { key: 'facility-10x30', kind: 'facility', rows: 40, cols: 310, make: (t) => facility(t, 10, 30, 1030) },
  { key: 'facility-15x50', kind: 'facility', rows: 65, cols: 765, make: (t) => facility(t, 15, 50, 1550) },
  { key: 'facility-20x60', kind: 'facility', rows: 80, cols: 1220, make: (t) => facility(t, 20, 60, 2060) },
];

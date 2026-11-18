// The benchmark problems: linear programs made by a seeded generator and written as free MPS files to bench/data/,
// so smaltlp and HiGHS read the same bytes. Each is feasible and bounded by construction: rows a·x ≤ b with b at least
// a·x0 for a point x0 inside every variable's box [0, 10], and costs of both signs. About 10% of the matrix is non-zero.
//   import { makeData, SIZES } from './data.mjs'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

/** The sizes: rows (m) by columns (n). */
export const SIZES = [
  { key: 'lp-50x75', m: 50, n: 75 },
  { key: 'lp-150x225', m: 150, n: 225 },
  { key: 'lp-300x450', m: 300, n: 450 },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** The MPS text of one problem. */
export function problem(m, n, seed) {
  const r = rng(seed);
  const x0 = Array.from({ length: n }, () => r() * 10);
  const cols = Array.from({ length: n }, () => []);
  const rows = Array.from({ length: m }, () => 0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (r() < 0.1) {
        const a = Math.round((r() * 10 - 2) * 100) / 100;
        if (a === 0) continue;
        cols[j].push([i, a]);
        rows[i] += a * x0[j];
      }
    }
  }
  const c = Array.from({ length: n }, () => Math.round((r() * 20 - 10) * 100) / 100);
  const out = [`NAME          LP${m}X${n}`, 'ROWS', ' N  COST'];
  for (let i = 0; i < m; i++) out.push(` L  R${i}`);
  out.push('COLUMNS');
  for (let j = 0; j < n; j++) {
    out.push(`    X${j} COST ${c[j]}`);
    for (const [i, a] of cols[j]) out.push(`    X${j} R${i} ${a}`);
  }
  out.push('RHS');
  for (let i = 0; i < m; i++) out.push(`    RHS R${i} ${Math.round((rows[i] + r() * 5) * 1e4) / 1e4}`);
  out.push('BOUNDS');
  for (let j = 0; j < n; j++) out.push(` UP BND X${j} 10`);
  out.push('ENDATA', '');
  return out.join('\n');
}

/** Writes the problems to `dir`, once. */
export function makeData(dir) {
  mkdirSync(dir, { recursive: true });
  SIZES.forEach(({ key, m, n }, k) => {
    const path = `${dir}/${key}.mps`;
    if (!existsSync(path)) writeFileSync(path, problem(m, n, 1000 + k));
  });
  writeFileSync(`${dir}/meta.json`, JSON.stringify(SIZES));
}

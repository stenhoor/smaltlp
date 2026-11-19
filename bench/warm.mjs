// Times branch-and-bound with and without warm starts on the same integer programs (bench/problems.mjs: knapsacks and
// facility location), from a built package (npm run build first): every node from its parent's basis and
// factorization, against every node from the start (with presolve, as before warm starts). Both solve to a gap of 0,
// so both prove the same optimum. The median of 3 runs after a warm-up, on one thread. Writes
// bench/results/warm.json and the table in docs/research/benchmarks.md between its <!-- bench:warm --> markers.
//   node bench/warm.mjs
// SMALTLP_DIST=path/to/dist times another build (an older commit's, say), and only prints its table.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { MIPS } from './problems.mjs';

const other = process.env.SMALTLP_DIST;
const dist = other ? pathToFileURL(resolve(other)).href : new URL('../dist', import.meta.url).href;
const { branchAndBound } = await import(`${dist}/mip/branch.js`);
const { fromTriplets } = await import(`${dist}/core/sparse.js`);
const { VERSION } = await import(`${dist}/index.js`);

const median = (f, reps) => {
  f();
  const ts = [];
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    f();
    ts.push(performance.now() - t);
  }
  return ts.sort((a, b) => a - b)[Math.floor(ts.length / 2)];
};

const results = {};
for (const { key, rows: m, cols: n, make } of MIPS) {
  const { lp, integer } = make(fromTriplets);
  const run = (warmStart) => () => branchAndBound(lp, { integer, relGap: 0, nodeLimit: Infinity, timeLimit: Infinity, presolve: true, tol: 1e-7, maxIter: 2 ** 31 - 1, warmStart });
  const row = { rows: m, cols: n };
  for (const [name, warm] of [['warm', true], ['cold', false]]) {
    const b = run(warm)();
    if (b.end !== 'optimal') throw new Error(`${key} ${name}: ${b.end}`);
    row[name] = { milliseconds: median(run(warm), 3), nodes: b.nodes, iterations: b.nit, objective: b.objective };
  }
  if (Math.abs(row.warm.objective - row.cold.objective) > 1e-9 * (1 + Math.abs(row.cold.objective))) throw new Error(`${key}: the objectives differ`);
  results[key] = row;
}
if (other) {
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
}
const meta = { library: `smaltlp ${VERSION}`, runtime: `Node ${process.versions.node}`, cpu: cpus()[0]?.model ?? 'unknown', date: new Date().toISOString().slice(0, 10) };
mkdirSync(new URL('./results', import.meta.url).pathname, { recursive: true });
writeFileSync(new URL('./results/warm.json', import.meta.url), JSON.stringify({ ...meta, results }, null, 1) + '\n');

const fmt = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const lines = [
  '| Problem | Rows × columns | Nodes | Iterations: warm | Iterations: cold | Warm, ms | Cold, ms | Warm ÷ cold, time |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const [key, r] of Object.entries(results)) {
  const nodes = r.warm.nodes === r.cold.nodes ? r.warm.nodes : `${r.warm.nodes} / ${r.cold.nodes}`;
  lines.push(`| ${key} | ${r.rows} × ${r.cols} | ${nodes} | ${r.warm.iterations} | ${r.cold.iterations} | ${fmt(r.warm.milliseconds)} | ${fmt(r.cold.milliseconds)} | ${(r.warm.milliseconds / r.cold.milliseconds).toFixed(2)} |`);
}
lines.push('', `Run ${meta.date}: ${meta.library} on ${meta.runtime}. CPU: ${meta.cpu}. Both prove the same optimum.`);
const page = new URL('../docs/research/benchmarks.md', import.meta.url);
const text = readFileSync(page, 'utf8');
const [before, rest] = text.split('<!-- bench:warm -->');
const [, after] = rest.split('<!-- /bench:warm -->');
writeFileSync(page, `${before}<!-- bench:warm -->\n\n${lines.join('\n')}\n\n<!-- /bench:warm -->${after}`);
console.log(lines.join('\n'));

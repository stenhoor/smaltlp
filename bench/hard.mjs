// Times branch-and-bound on the harder integer programs (bench/problems.mjs, HARD_MIPS: thousands to tens of thousands
// of nodes), from a built package (npm run build first), to a gap of 0, with its default options. One run of each
// after the problems are made: the larger take tens of seconds, so their time moves little from run to run. Writes
// bench/results/hard.json and the table in docs/research/benchmarks.md between its <!-- bench:hard --> markers.
//   node bench/hard.mjs
// SMALTLP_DIST=path/to/dist times another build (an older commit's, say), and only prints its results.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { HARD_MIPS } from './problems.mjs';

const other = process.env.SMALTLP_DIST;
const dist = other ? pathToFileURL(resolve(other)).href : new URL('../dist', import.meta.url).href;
const { branchAndBound } = await import(`${dist}/mip/branch.js`);
const { fromTriplets } = await import(`${dist}/core/sparse.js`);
const { VERSION } = await import(`${dist}/index.js`);

const results = {};
for (const { key, rows: m, cols: n, make } of HARD_MIPS) {
  const { lp, integer } = make(fromTriplets);
  const t = performance.now();
  const b = branchAndBound(lp, { integer, relGap: 0, nodeLimit: Infinity, timeLimit: Infinity, presolve: true, tol: 1e-7, maxIter: 2 ** 31 - 1 });
  const milliseconds = performance.now() - t;
  if (b.end !== 'optimal') throw new Error(`${key}: ${b.end}`);
  results[key] = { rows: m, cols: n, milliseconds, nodes: b.nodes, iterations: b.nit, objective: b.objective };
  console.error(`${key}: ${b.nodes} nodes, ${(milliseconds / 1000).toFixed(1)} s`);
}
if (other) {
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
}
const meta = { library: `smaltlp ${VERSION}`, runtime: `Node ${process.versions.node}`, cpu: cpus()[0]?.model ?? 'unknown', date: new Date().toISOString().slice(0, 10) };
mkdirSync(new URL('./results', import.meta.url).pathname, { recursive: true });
writeFileSync(new URL('./results/hard.json', import.meta.url), JSON.stringify({ ...meta, results }, null, 1) + '\n');

const lines = ['| Problem | Rows × columns | Nodes | Iterations | Seconds |', '| --- | --- | ---: | ---: | ---: |'];
for (const [key, r] of Object.entries(results)) {
  lines.push(`| ${key} | ${r.rows} × ${r.cols} | ${r.nodes.toLocaleString('en-US')} | ${r.iterations.toLocaleString('en-US')} | ${(r.milliseconds / 1000).toFixed(1)} |`);
}
lines.push('', `Run ${meta.date}: ${meta.library} on ${meta.runtime}. CPU: ${meta.cpu}. One run of each.`);
const page = new URL('../docs/research/benchmarks.md', import.meta.url);
const text = readFileSync(page, 'utf8');
const [before, rest] = text.split('<!-- bench:hard -->');
const [, after] = rest.split('<!-- /bench:hard -->');
writeFileSync(page, `${before}<!-- bench:hard -->\n\n${lines.join('\n')}\n\n<!-- /bench:hard -->${after}`);
console.log(lines.join('\n'));

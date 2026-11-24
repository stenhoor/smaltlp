// Times branch-and-bound on the harder integer programs (bench/problems.mjs, HARD_MIPS: thousands to tens of thousands
// of nodes), from a built package (npm run build first), to a gap of 0, with each branching rule: reliability
// branching (the default) and the most fractional column. One run of each, the default's first: the larger take tens
// of seconds, so their time moves little from run to run. Both must prove the same optimum. Writes
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

const RULES = ['reliability', 'mostFractional'];
const results = {};
for (const { key, rows: m, cols: n, make } of HARD_MIPS) {
  const { lp, integer } = make(fromTriplets);
  const row = { rows: m, cols: n };
  for (const branching of RULES) {
    const t = performance.now();
    const b = branchAndBound(lp, { integer, relGap: 0, nodeLimit: Infinity, timeLimit: Infinity, presolve: true, tol: 1e-7, maxIter: 2 ** 31 - 1, branching });
    const milliseconds = performance.now() - t;
    if (b.end !== 'optimal') throw new Error(`${key} (${branching}): ${b.end}`);
    row[branching] = { milliseconds, nodes: b.nodes, iterations: b.nit, objective: b.objective };
    console.error(`${key} (${branching}): ${b.nodes} nodes, ${(milliseconds / 1000).toFixed(1)} s`);
  }
  const [a, b] = RULES.map((r) => row[r].objective);
  if (Math.abs(a - b) > 1e-9 * (1 + Math.abs(b))) throw new Error(`${key}: the objectives differ`);
  results[key] = row;
}
if (other) {
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
}
const meta = { library: `smaltlp ${VERSION}`, runtime: `Node ${process.versions.node}`, cpu: cpus()[0]?.model ?? 'unknown', date: new Date().toISOString().slice(0, 10) };
mkdirSync(new URL('./results', import.meta.url).pathname, { recursive: true });
writeFileSync(new URL('./results/hard.json', import.meta.url), JSON.stringify({ ...meta, results }, null, 1) + '\n');

const num = (v) => v.toLocaleString('en-US');
const lines = [
  '| Problem | Rows × columns | Nodes: reliability | Nodes: most fractional | Iterations: reliability | Iterations: most fractional | Seconds: reliability | Seconds: most fractional | Reliability ÷ most fractional, time |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const [key, r] of Object.entries(results)) {
  const [a, b] = [r.reliability, r.mostFractional];
  lines.push(`| ${key} | ${r.rows} × ${r.cols} | ${num(a.nodes)} | ${num(b.nodes)} | ${num(a.iterations)} | ${num(b.iterations)} | ${(a.milliseconds / 1000).toFixed(1)} | ${(b.milliseconds / 1000).toFixed(1)} | ${(a.milliseconds / b.milliseconds).toFixed(2)} |`);
}
lines.push('', `Run ${meta.date}: ${meta.library} on ${meta.runtime}. CPU: ${meta.cpu}. One run of each. Both prove the same optimum.`);
const page = new URL('../docs/research/benchmarks.md', import.meta.url);
const text = readFileSync(page, 'utf8');
const [before, rest] = text.split('<!-- bench:hard -->');
const [, after] = rest.split('<!-- /bench:hard -->');
writeFileSync(page, `${before}<!-- bench:hard -->\n\n${lines.join('\n')}\n\n<!-- /bench:hard -->${after}`);
console.log(lines.join('\n'));

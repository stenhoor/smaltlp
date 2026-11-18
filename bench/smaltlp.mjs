// Times smaltlp on the benchmark problems (bench/data.mjs), from the built package (npm run build first): each read
// from its MPS file and solved by linprogSync, the median of several runs after a warm-up, on one thread. Writes
// bench/results/smaltlp.json.
//   node bench/smaltlp.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { makeData, SIZES } from './data.mjs';

const lp = await import('../dist/index.js');
const dir = new URL('./data', import.meta.url).pathname;
makeData(dir);

/** linprog's input from a read MPS model whose rows are all ≤ (as the generator writes them). */
function linprogInput(model) {
  const { row, col, value } = model.entries;
  return {
    c: model.c,
    options: {
      AUb: { rows: model.rowNames.length, cols: model.colNames.length, i: row, j: col, v: value },
      bUb: model.rowUp,
      bounds: model.colNames.map((_, j) => [model.colLo[j], model.colUp[j]]),
    },
  };
}

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
for (const { key, m, n } of SIZES) {
  const model = lp.readMps(readFileSync(`${dir}/${key}.mps`, 'utf8'));
  const { c, options } = linprogInput(model);
  const res = lp.linprogSync(c, options);
  if (res.status !== 0) throw new Error(`${key}: ${res.message}`);
  const reps = m < 200 ? 7 : 3;
  results[key] = { rows: m, cols: n, milliseconds: median(() => lp.linprogSync(c, options), reps), iterations: res.nit, objective: res.fun };
}
mkdirSync(new URL('./results', import.meta.url).pathname, { recursive: true });
writeFileSync(
  new URL('./results/smaltlp.json', import.meta.url),
  JSON.stringify({ library: `smaltlp ${lp.VERSION}`, runtime: `Node ${process.versions.node}`, cpu: cpus()[0]?.model ?? 'unknown', date: new Date().toISOString().slice(0, 10), results }, null, 1) + '\n',
);
console.log(JSON.stringify(results, null, 1));

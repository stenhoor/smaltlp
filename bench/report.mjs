// Writes the results table of docs/research/benchmarks.md from bench/results/smaltlp.json and highs.json, between the
// page's <!-- bench:results --> markers. The page's method and notes stay as written. Fails if the two disagree on an
// objective by more than 1e-7, relative: a timing is only worth reading for the same answer.
//   node bench/report.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const res = (f) => JSON.parse(readFileSync(new URL(`./results/${f}`, import.meta.url), 'utf8'));
const lp = res('smaltlp.json');
const hi = res('highs.json');
const fmt = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const settings = Object.keys(Object.values(hi.results)[0]);

const lines = [];
const head = ['Problem', 'Rows × columns', 'smaltlp, ms', ...settings.map((s) => `${s}, ms`), ...settings.map((s) => `smaltlp ÷ ${s}`), 'Iterations: smaltlp', ...settings.map((s) => `Iterations: ${s}`)];
lines.push(`| ${head.join(' | ')} |`, `| --- | --- | ${head.slice(2).map(() => '---:').join(' | ')} |`);
for (const [key, r] of Object.entries(lp.results)) {
  const h = hi.results[key];
  for (const s of settings) {
    const a = r.objective;
    const b = h[s].objective;
    if (Math.abs(a - b) > 1e-7 * (1 + Math.abs(b))) throw new Error(`${key}: smaltlp's objective ${a} isn't ${s}'s ${b}`);
  }
  lines.push(
    `| ${[
      key,
      `${r.rows} × ${r.cols}`,
      fmt(r.milliseconds),
      ...settings.map((s) => fmt(h[s].milliseconds)),
      ...settings.map((s) => `${(r.milliseconds / h[s].milliseconds).toFixed(1)}×`),
      r.iterations,
      ...settings.map((s) => h[s].iterations),
    ].join(' | ')} |`,
  );
}
lines.push('', `Run ${lp.date}: ${lp.library} on ${lp.runtime}; ${hi.library} on ${hi.runtime}. CPU: ${lp.cpu}. Every objective agrees within 1e-7, relative.`);

const page = new URL('../docs/research/benchmarks.md', import.meta.url);
const text = readFileSync(page, 'utf8');
const [before, rest] = text.split('<!-- bench:results -->');
const [, after] = rest.split('<!-- /bench:results -->');
writeFileSync(page, `${before}<!-- bench:results -->\n\n${lines.join('\n')}\n\n<!-- /bench:results -->${after}`);
console.log(lines.join('\n'));

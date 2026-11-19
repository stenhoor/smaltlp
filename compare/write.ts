// The compare run's writing step (compare/run.py runs it): reads every MPS and LP case of fixtures-in.json with
// smaltlp's readers, writes each with writeLp and writeMps (free and fixed), and prints the texts as JSON, so HiGHS
// can read them back. A case a writer refuses (a name too long for fixed MPS, say) gets null.
//   node compare/write.ts cases.json
import { readFileSync } from 'node:fs';
import { readLp, readMps, writeLp, writeMps } from '../src/io/index.ts';

const cases: { name: string; kind: 'mps' | 'lp'; text: string }[] = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const out: Record<string, { lp: string | null; mps: string | null; mpsFixed: string | null }> = {};
const tryWrite = (f: () => string): string | null => {
  try {
    return f();
  } catch {
    return null;
  }
};
for (const k of cases) {
  let model;
  try {
    model = k.kind === 'mps' ? readMps(k.text) : readLp(k.text);
  } catch {
    continue;
  }
  out[`${k.kind}:${k.name}`] = {
    lp: tryWrite(() => writeLp(model)),
    mps: tryWrite(() => writeMps(model)),
    mpsFixed: tryWrite(() => writeMps(model, { format: 'fixed' })),
  };
}
console.log(JSON.stringify(out));

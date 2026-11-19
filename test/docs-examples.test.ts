/**
 * Examples are tests (BRAND.md, Documentation, rule 5). Every ```ts example in docs/ runs as its playground runs it
 * (theme/smaltlp.ts): after the page's examples above it, in one scope. The table printed under it is its tested
 * result, row for row; a long one prints its first rows and `… N more rows`. An example marked
 * `<!-- docs:error CODE -->` must fail with CODE. A fence marked `noplay`, or after `<!-- docs:skip -->`, is not run.
 * Each example is also type-checked by smaltty, as a reader's editor would check it.
 *
 * `UPDATE_DOCS=1 npm test` writes the printed results into the pages.
 *
 * The shape follows smaltml's test/docs-examples.test.ts, on node:test (the family's runner) instead of vitest.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { typeChecker } from 'smaltkit/typechecker';
import { runExample, toTable } from '../docs/.vitepress/theme/smaltlp.ts';
import type { SetupStep } from '../docs/.vitepress/theme/playground.ts';

const UPDATE = !!process.env.UPDATE_DOCS;
const LONG = 12;
const SHORT = 6;
const DOCS = new URL('../docs/', import.meta.url).pathname;

function markdown(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f);
      if (f.startsWith('.') || f === 'node_modules' || f === 'public') return [];
      return statSync(p).isDirectory() ? markdown(p) : p.endsWith('.md') ? [p] : [];
    });
}

interface Example {
  line: number;
  end: number;
  table: { from: number; to: number } | null;
  /** Text right under the table, left over from an earlier one: its line, or null. */
  debris: number | null;
  code: string;
  fails?: string;
  setup: SetupStep[];
}

function examples(file: string): Example[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: Example[] = [];
  const setup: SetupStep[] = [];
  let markers: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^<!--\s*(docs:[\s\S]*?)\s*-->\s*$/.exec(line.trim());
    if (marker) {
      markers.push(marker[1]!);
      continue;
    }
    const open = /^```(\S*)\s*(.*)$/.exec(line);
    if (!open) {
      if (line.trim()) markers = [];
      continue;
    }
    const start = i;
    for (i++; i < lines.length && lines[i] !== '```'; i++);
    const [lang, info] = [open[1]!, open[2]!];
    const kinds = markers.map((m) => m.split(/\s+/)[0]);
    const fails = markers.find((m) => m.startsWith('docs:error'))?.split(/\s+/)[1];
    markers = [];
    if (lang !== 'ts' || kinds.includes('docs:skip')) continue;
    // As the kit's playground does: a noplay fence doesn't run, but is setup for the examples below it.
    if (info.split(/\s+/).includes('noplay')) {
      setup.push(lines.slice(start + 1, i).join('\n').trim());
      continue;
    }
    const code = lines.slice(start + 1, i).join('\n');
    let j = i + 1;
    while (j < lines.length && !lines[j]!.trim()) j++;
    let table: Example['table'] = null;
    if (lines[j]?.startsWith('|')) {
      const from = j;
      while (j < lines.length && lines[j]!.startsWith('|')) j++;
      table = { from, to: j };
    }
    // A table ends at a blank line or the file's end: text right under it is left over from an earlier table.
    const debris = table && j < lines.length && lines[j]!.trim() ? j + 1 : null;
    out.push({ line: start + 1, end: i, table, debris, code, fails, setup: setup.slice() });
    setup.push(fails !== undefined ? { sql: code.trim(), fails: true } : code.trim());
  }
  return out;
}

/** A result as the Markdown table under its example. */
function render(t: { columns: string[]; rows: string[][]; note?: string }): string[] {
  if (t.note !== undefined) return [];
  // A line break would split a row over several lines: return the lines as rows instead.
  for (const c of [...t.columns, ...t.rows.flat()]) {
    if (/[\r\n]/.test(c)) throw new Error(`a result cell holds a line break, which a table can't show; return the lines as rows: ${JSON.stringify(c.slice(0, 40))}`);
  }
  const rows = t.rows.length > LONG ? t.rows.slice(0, SHORT) : t.rows;
  // Escaped for Markdown: | ends a cell, VitePress reads {…} at a cell's end as attributes, and * and _ would turn
  // an expression such as 3*x + 2*y into emphasis.
  const esc = (c: string) => c.replace(/[|{}*_]/g, '\\$&');
  const out = [`| ${t.columns.map(esc).join(' | ')} |`, `| ${t.columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)];
  if (t.rows.length > LONG) out.push(`| … ${t.rows.length - SHORT} more rows |${' |'.repeat(Math.max(0, t.columns.length - 1))}`);
  return out;
}

/** smaltlp's source, for smaltty to check the examples against, by its package names. */
const SRC = new URL('../src/', import.meta.url).pathname;
function sources(dir: string): [string, string][] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [[`/src/${p.slice(SRC.length)}`, readFileSync(p, 'utf8')] as [string, string]] : [];
  });
}
const AREAS = ['lp', 'mip', 'model', 'io', 'tables', 'worker'];
const checkTypes = typeChecker({
  files: Object.fromEntries(sources(SRC)),
  packages: { '@smaltworks/smaltlp': '/src/index.ts', ...Object.fromEntries(AREAS.map((a) => [`@smaltworks/smaltlp/${a}`, `/src/${a}/index.ts`])) },
  checks: ['this', 'overloads', 'variables'],
});

/** The code smaltty checks for an example: a module, the setup above it, then the example; repeated imports once. */
function checkedCode(ex: Example): { code: string; first: number } {
  const seen = new Set<string>();
  const once = (part: string) =>
    part
      .split('\n')
      .filter((l) => !/^\s*import\s/.test(l) || (!seen.has(l.trim()) && !!seen.add(l.trim())))
      .join('\n');
  const before = ['export {};', ...ex.setup.map((s) => (typeof s === 'string' ? s : s.sql)).map(once)].join('\n;\n') + '\n;\n';
  return { code: before + once(ex.code), first: before.split('\n').length };
}

const files = markdown(DOCS);
const updates = new Map<string, { at: Example; table: string[] }[]>();

for (const file of files) {
  const list = examples(file);
  if (list.length === 0) continue;
  describe(file.slice(DOCS.length), () => {
    for (const ex of list) {
      if (ex.debris !== null) {
        test(`line ${ex.line}'s table ends cleanly`, () => {
          assert.fail(`${file}:${ex.debris}: text right under the table; a table ends at a blank line (left over from an earlier table?)`);
        });
      }
      test(`line ${ex.line} type-checks (smaltty)`, () => {
        const { code, first } = checkedCode(ex);
        const own = checkTypes(code).filter((w) => w.line >= first);
        assert.deepEqual(own.map((w) => `line ${ex.line + w.line - first + 1}: TS${w.code} ${w.message}`), [], `${file}:${ex.line}`);
      });
      test(`line ${ex.line}`, async () => {
        if (ex.fails !== undefined) {
          await assert.rejects(runExample(ex.code, ex.setup), (e: unknown) => (e as { code?: string }).code === ex.fails, `${file}:${ex.line}: should fail with ${ex.fails}`);
          return;
        }
        const table = render(toTable(await runExample(ex.code, ex.setup)));
        const lines = readFileSync(file, 'utf8').split('\n');
        const printed = ex.table ? lines.slice(ex.table.from, ex.table.to) : [];
        if (UPDATE) {
          const pending = updates.get(file) ?? [];
          pending.push({ at: ex, table });
          updates.set(file, pending);
          return;
        }
        assert.deepEqual(printed.map((l) => l.trim()), table, `${file}:${ex.line}: run UPDATE_DOCS=1 npm test to rewrite`);
      });
    }
  });
}

if (UPDATE) {
  after(() => {
    for (const [file, list] of updates) {
      const lines = readFileSync(file, 'utf8').split('\n');
      // From the bottom up, so earlier line numbers stay right.
      for (const { at, table } of [...list].sort((a, b) => b.at.end - a.at.end)) {
        if (at.table) lines.splice(at.table.from, at.table.to - at.table.from, ...table);
        else if (table.length) lines.splice(at.end + 1, 0, '', ...table);
      }
      writeFileSync(file, lines.join('\n'));
    }
  });
}

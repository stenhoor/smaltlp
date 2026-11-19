/**
 * Reading and writing CPLEX LP files (smaltworks ADR 0039, section 5): the row-oriented text format, an objective and
 * constraints written as algebra, then bounds and integer sections.
 *
 * Sections, by their keywords in any case: the objective (Minimize, Minimise, Minimum, Min, Maximize, Maximise,
 * Maximum, Max), the constraints (Subject To, Such That, st, s.t.), Bounds, Generals (General, Gen, Integers), Binaries
 * (Binary, Bin) and End. A backslash starts a comment, to the end of its line. What the reader can't represent fails
 * with LP_UNSUPPORTED (quadratic terms, semi-continuous variables, SOS, indicator constraints), and what breaks the
 * format with LP_FORMAT, naming the line.
 *
 * Where readers differ, this one does what HiGHS's does (HiGHS 1.16.0, checked by the compare tests), with one
 * exception: a constant on a constraint's left side, which HiGHS ignores with a warning, fails here, since ignoring
 * it would change the model.
 * - A constraint has one sense and a number on its right; a range (`-2 <= x - y <= 3`) or a variable on the right
 *   fails, as in HiGHS.
 * - A variable named twice in one row or in the objective has its coefficients summed.
 * - Columns are numbered in the order they first appear; a constraint without a name is `R1`, `R2` … by its place.
 * - An upper bound below 0 leaves the lower bound as it is (0 by default), as HiGHS's MPS reader does.
 * - A Binaries entry is integer, from 0 to 1, whatever bounds it had.
 *
 * Written from the format's published descriptions (the CPLEX documentation, "LP file format: algebraic
 * representation"), not from any solver's code.
 * @module
 */
import { fail } from '../core/errors.ts';
import type { MpsModel } from './mps.ts';

type Section = 'objective' | 'constraints' | 'bounds' | 'generals' | 'binaries' | 'end' | null;

type Token =
  | { kind: 'num'; value: number; line: number }
  | { kind: 'name'; text: string; line: number }
  | { kind: 'op'; text: string; line: number }
  | { kind: 'section'; section: Section; line: number };

const KEYWORDS: [RegExp, Section | 'minimize' | 'maximize' | 'unsupported'][] = [
  [/^(minimize|minimise|minimum|min)$/i, 'minimize'],
  [/^(maximize|maximise|maximum|max)$/i, 'maximize'],
  [/^(subject\s+to|such\s+that|st|s\.t\.)$/i, 'constraints'],
  [/^(bounds?)$/i, 'bounds'],
  [/^(generals?|gen|integers?)$/i, 'generals'],
  [/^(binary|binaries|bin)$/i, 'binaries'],
  [/^(semi-continuous|semi|semis|sos|sos1|sos2)$/i, 'unsupported'],
  [/^end$/i, 'end'],
];

/** A name: a letter or one of the format's symbols first, then those, digits and periods. */
const NAME_START = /[A-Za-z!"#$%&()/,;?@_`'{}|~]/;
const NAME_CHAR = /[A-Za-z0-9!"#$%&()/,.;?@_`'{}|~]/;

/** Reads a CPLEX LP file's text, into the same model shape {@link readMps} gives. */
export function readLp(text: string): MpsModel {
  if (typeof text !== 'string') fail('LP_PARAM', "readLp takes the file's text, as a string");
  let sense: 'minimize' | 'maximize' | null = null;
  const tokens = tokenize(text, (s) => (sense = s));

  const colIndex = new Map<string, number>();
  const colNames: string[] = [];
  const c: number[] = [];
  const lo: number[] = [];
  const up: number[] = [];
  const integer: number[] = [];
  const col = (name: string): number => {
    let j = colIndex.get(name);
    if (j === undefined) {
      j = colNames.length;
      colIndex.set(name, j);
      colNames.push(name);
      c.push(0);
      lo.push(0);
      up.push(Infinity);
      integer.push(0);
    }
    return j;
  };
  const rowNames: string[] = [];
  const rowLo: number[] = [];
  const rowUp: number[] = [];
  const ei: number[] = [];
  const ej: number[] = [];
  const ev: number[] = [];
  let objectiveName = 'obj';
  let offset = 0;

  let p = 0;
  const at = () => tokens[p];
  const lineOf = () => tokens[Math.min(p, tokens.length - 1)]?.line ?? 1;
  const bad = (msg: string, line = lineOf()): never => fail('LP_FORMAT', `line ${line}: ${msg}`);
  const isOp = (t: Token | undefined, ...ops: string[]) => t?.kind === 'op' && ops.includes(t.text);
  const isSense = (t: Token | undefined) => isOp(t, '<=', '>=', '=', '<', '>', '=<', '=>');
  const atSectionEnd = () => p >= tokens.length || at()!.kind === 'section';
  /** An optional `name:` label. */
  const label = (): string | null => {
    const t = at();
    if (t?.kind === 'name' && isOp(tokens[p + 1], ':')) {
      p += 2;
      return t.text;
    }
    return null;
  };
  /**
   * A linear expression: signed terms `[sign] [number] name` and constants, until something else. Returns the
   * terms (summed by column) and the constant.
   */
  const expression = (where: string): { terms: Map<number, number>; constant: number; any: boolean } => {
    const terms = new Map<number, number>();
    let constant = 0;
    let any = false;
    for (;;) {
      const start = p;
      let sign = 1;
      let signed = false;
      while (isOp(at(), '+', '-')) {
        if ((at() as { text: string }).text === '-') sign = -sign;
        signed = true;
        p++;
      }
      // After the first term, the next needs its sign: `x y` is two names, not a sum.
      if (any && !signed) return { terms, constant, any };
      const t = at();
      if (isOp(t, '[')) fail('LP_UNSUPPORTED', `line ${t!.line}: quadratic terms ([ … ]) aren't supported`);
      if (t?.kind === 'num') {
        p++;
        const next = at();
        if (next?.kind === 'name' && !isOp(tokens[p + 1], ':')) {
          p++;
          const j = col(next.text);
          terms.set(j, (terms.get(j) ?? 0) + sign * t.value);
        } else {
          if (!Number.isFinite(t.value)) bad(`an infinite constant in ${where}`, t.line);
          constant += sign * t.value;
        }
        any = true;
        continue;
      }
      if (t?.kind === 'name' && !isOp(tokens[p + 1], ':')) {
        p++;
        const j = col(t.text);
        terms.set(j, (terms.get(j) ?? 0) + sign);
        any = true;
        continue;
      }
      if (signed) {
        p = start;
        bad(`a sign with nothing after it in ${where}`);
      }
      return { terms, constant, any };
    }
  };
  /** A number, possibly signed, possibly infinite. */
  const number = (what: string): number => {
    let sign = 1;
    while (isOp(at(), '+', '-')) {
      if ((at() as { text: string }).text === '-') sign = -sign;
      p++;
    }
    const t = at();
    if (t?.kind !== 'num') bad(`expected a number for ${what}, found ${describe(t)}`);
    p++;
    return sign * (t as { value: number }).value;
  };
  const senseOf = (t: Token): '<=' | '>=' | '=' => {
    const op = (t as { text: string }).text;
    return op === '<' || op === '<=' || op === '=<' ? '<=' : op === '>' || op === '>=' || op === '=>' ? '>=' : '=';
  };

  let section: Section = null;
  while (p < tokens.length) {
    const t = at()!;
    if (t.kind === 'section') {
      if (section === null && t.section !== 'objective') bad(`expected Minimize or Maximize first, found a ${t.section} section`, t.line);
      section = t.section;
      p++;
      if (section === 'end') break;
      continue;
    }
    if (section === null) bad(`expected Minimize or Maximize first, found ${describe(t)}`);
    if (section === 'objective') {
      const name = label();
      if (name !== null) objectiveName = name;
      const e = expression('the objective');
      for (const [j, v] of e.terms) c[j]! += v;
      offset += e.constant;
      if (!atSectionEnd()) bad(`unexpected ${describe(at())} in the objective`);
    } else if (section === 'constraints') {
      const line = t.line;
      const name = label() ?? `R${rowNames.length + 1}`;
      const e = expression(`constraint ${name}`);
      if (isOp(at(), '->')) fail('LP_UNSUPPORTED', `line ${at()!.line}: indicator constraints (->) aren't supported`);
      if (!e.any) bad(`constraint ${name} has no left side`, line);
      if (!isSense(at())) bad(`expected <=, >= or = in constraint ${name}, found ${describe(at())}`);
      const s = senseOf(at()!);
      p++;
      if (e.constant !== 0) bad(`constraint ${name} has a constant on its left side; move it to the right`, line);
      const rhsLine = lineOf();
      if (at()?.kind === 'name') bad(`constraint ${name} has a variable on its right side; the right side is a number`, rhsLine);
      const rhs = number(`constraint ${name}'s right side`);
      if (isSense(at())) bad(`constraint ${name} has two senses; a range (lo <= expression <= up) isn't LP format`, rhsLine);
      const r = rowNames.length;
      rowNames.push(name);
      rowLo.push(s === '<=' ? -Infinity : rhs);
      rowUp.push(s === '>=' ? Infinity : rhs);
      for (const [j, v] of e.terms) {
        ei.push(r);
        ej.push(j);
        ev.push(v);
      }
    } else if (section === 'bounds') {
      bound();
    } else {
      // Generals or Binaries: a list of names.
      if (t.kind !== 'name') bad(`expected a variable's name in ${section === 'generals' ? 'Generals' : 'Binaries'}, found ${describe(t)}`);
      p++;
      const j = col((t as { text: string }).text);
      integer[j] = 1;
      if (section === 'binaries') {
        lo[j] = 0;
        up[j] = 1;
      }
    }
  }
  if (sense === null) fail('LP_FORMAT', 'line 1: the file has no Minimize or Maximize section');

  /** One bound: `x free`, `x <= u`, `x >= l`, `x = v`, `l <= x`, `l <= x <= u`, and the like. */
  function bound(): void {
    const line = lineOf();
    let first: number | null = null;
    let firstSense: '<=' | '>=' | '=' | null = null;
    if (at()?.kind !== 'name') {
      first = number('a bound');
      if (!isSense(at())) bad(`expected <=, >= or = after the bound ${first}, found ${describe(at())}`);
      firstSense = senseOf(at()!);
      p++;
    }
    const t = at();
    if (t?.kind !== 'name') bad(`expected a variable's name in Bounds, found ${describe(t)}`);
    p++;
    const j = col((t as { text: string }).text);
    if (first !== null) apply(j, flip(firstSense!), first, line);
    const next = at();
    if (first === null && next?.kind === 'name' && /^free$/i.test(next.text)) {
      p++;
      lo[j] = -Infinity;
      up[j] = Infinity;
      return;
    }
    if (isSense(next)) {
      const s = senseOf(next!);
      p++;
      apply(j, s, number(`${colNames[j]}'s bound`), line);
    } else if (first === null) {
      bad(`expected <=, >=, = or free after ${colNames[j]} in Bounds, found ${describe(next)}`);
    }
  }
  /** `l <= x` is `x >= l`. */
  function flip(s: '<=' | '>=' | '='): '<=' | '>=' | '=' {
    return s === '<=' ? '>=' : s === '>=' ? '<=' : '=';
  }
  function apply(j: number, s: '<=' | '>=' | '=', v: number, line: number): void {
    if (s === '=') {
      if (!Number.isFinite(v)) bad(`${colNames[j]} can't be fixed at ${v}`, line);
      lo[j] = v;
      up[j] = v;
    } else if (s === '>=') {
      if (v === Infinity) bad(`${colNames[j]}'s lower bound is Infinity`, line);
      lo[j] = v;
    } else {
      if (v === -Infinity) bad(`${colNames[j]}'s upper bound is -Infinity`, line);
      up[j] = v;
    }
  }

  return {
    name: '',
    sense: sense ?? 'minimize',
    objectiveName,
    offset,
    rowNames,
    rowLo: Float64Array.from(rowLo),
    rowUp: Float64Array.from(rowUp),
    colNames,
    c: Float64Array.from(c),
    colLo: Float64Array.from(lo),
    colUp: Float64Array.from(up),
    integer: Uint8Array.from(integer),
    entries: { row: Int32Array.from(ei), col: Int32Array.from(ej), value: Float64Array.from(ev) },
  };
}

function describe(t: Token | undefined): string {
  if (!t) return 'the end of the file';
  if (t.kind === 'num') return `the number ${t.value}`;
  if (t.kind === 'name') return `'${t.text}'`;
  if (t.kind === 'op') return `'${t.text}'`;
  return `a ${t.section} section`;
}

/** The file as tokens. Section keywords count only alone on their line (after any comment is removed). */
function tokenize(text: string, setSense: (s: 'minimize' | 'maximize') => void): Token[] {
  const out: Token[] = [];
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = ln + 1;
    const raw = lines[ln]!;
    const cut = raw.indexOf('\\');
    const body = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
    if (body === '') continue;
    const keyword = KEYWORDS.find(([re]) => re.test(body));
    if (keyword) {
      const k = keyword[1];
      if (k === 'unsupported') fail('LP_UNSUPPORTED', `line ${line}: the ${body} section isn't supported`);
      if (k === 'minimize' || k === 'maximize') {
        setSense(k);
        out.push({ kind: 'section', section: 'objective', line });
      } else {
        out.push({ kind: 'section', section: k, line });
      }
      continue;
    }
    let i = 0;
    while (i < body.length) {
      const ch = body[i]!;
      if (ch === ' ' || ch === '\t') {
        i++;
        continue;
      }
      const two = body.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '=<' || two === '=>' || two === '->') {
        out.push({ kind: 'op', text: two, line });
        i += 2;
        continue;
      }
      if ('<>=:+-[]*^'.includes(ch)) {
        out.push({ kind: 'op', text: ch, line });
        i++;
        continue;
      }
      const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(body.slice(i));
      if (num) {
        out.push({ kind: 'num', value: Number(num[0]), line });
        i += num[0].length;
        continue;
      }
      if (NAME_START.test(ch)) {
        let k = i + 1;
        while (k < body.length && NAME_CHAR.test(body[k]!)) k++;
        const word = body.slice(i, k);
        if (/^(inf|infinity)$/i.test(word)) out.push({ kind: 'num', value: Infinity, line });
        else out.push({ kind: 'name', text: word, line });
        i = k;
        continue;
      }
      fail('LP_FORMAT', `line ${line}: unexpected character '${ch}'`);
    }
  }
  return out;
}

export interface WriteOptions {
  /** The text after `\` on the first line. Default 'Written by smaltlp'. */
  comment?: string;
}

/**
 * A model as CPLEX LP text, which {@link readLp} and HiGHS read back to the same model (the compare tests check
 * HiGHS's reading). A ranged row (both sides finite and different) becomes two rows, `<name>lo` (≥) and `<name>up`
 * (≤), as HiGHS writes it; a row with neither side is left out, and so is its name. Names must be LP names: a letter
 * or one of !"#$%&()/,;?@_`'{}|~ first, then those, digits and periods; another fails with LP_VALUE.
 */
export function writeLp(model: MpsModel, options: WriteOptions = {}): string {
  const n = model.colNames.length;
  for (const name of model.colNames) lpName(name, 'variable');
  for (const name of model.rowNames) lpName(name, 'constraint');
  const objName = model.objectiveName && isLpName(model.objectiveName) ? model.objectiveName : 'obj';
  const out: string[] = [`\\ ${options.comment ?? 'Written by smaltlp'}`, model.sense === 'maximize' ? 'Maximize' : 'Minimize'];
  const terms = (pairs: [number, number][]) => pairs.map(([j, v]) => `${v < 0 || Object.is(v, -0) ? '-' : '+'}${num(Math.abs(v))} ${model.colNames[j]}`).join(' ');
  const mentioned = new Uint8Array(n);
  const obj: [number, number][] = [];
  for (let j = 0; j < n; j++) if (model.c[j] !== 0) (obj.push([j, model.c[j]!]), (mentioned[j] = 1));
  let objLine = ` ${objName}:${obj.length ? ' ' + terms(obj) : ''}`;
  if (model.offset !== 0) objLine += ` ${model.offset < 0 ? '-' : '+'}${num(Math.abs(model.offset))}`;
  out.push(objLine, 'Subject To');
  const rows: [number, number][][] = model.rowNames.map(() => []);
  const { row, col, value } = model.entries;
  for (let k = 0; k < value.length; k++) {
    if (value[k] === 0) continue;
    rows[row[k]!]!.push([col[k]!, value[k]!]);
    mentioned[col[k]!] = 1;
  }
  model.rowNames.forEach((name, r) => {
    const l = model.rowLo[r]!;
    const u = model.rowUp[r]!;
    if (l === -Infinity && u === Infinity) return;
    // A row with no entries still needs a variable: the first column, at 0.
    const lhs = rows[r]!.length ? terms(rows[r]!) : n ? `+0 ${model.colNames[0]}` : fail('LP_UNSUPPORTED', `constraint ${name} has no entries and the model no variables`);
    if (l === u) out.push(` ${name}: ${lhs} = ${num(u)}`);
    else if (l === -Infinity) out.push(` ${name}: ${lhs} <= ${num(u)}`);
    else if (u === Infinity) out.push(` ${name}: ${lhs} >= ${num(l)}`);
    else out.push(` ${name}lo: ${lhs} >= ${num(l)}`, ` ${name}up: ${lhs} <= ${num(u)}`);
  });
  const bounds: string[] = [];
  const generals: string[] = [];
  const binaries: string[] = [];
  for (let j = 0; j < n; j++) {
    const name = model.colNames[j]!;
    const l = model.colLo[j]!;
    const u = model.colUp[j]!;
    if (model.integer[j] && l === 0 && u === 1) {
      binaries.push(name);
      continue;
    }
    if (model.integer[j]) generals.push(name);
    if (l === u) bounds.push(` ${name} = ${num(l)}`);
    else if (l === -Infinity && u === Infinity) bounds.push(` ${name} free`);
    else if (l === -Infinity) bounds.push(` -inf <= ${name} <= ${num(u)}`);
    else if (u === Infinity) {
      if (l !== 0 || !mentioned[j] && !model.integer[j]) bounds.push(` ${name} >= ${num(l)}`);
    } else if (l === 0 && u >= 0) bounds.push(` ${name} <= ${num(u)}`);
    else bounds.push(` ${num(l)} <= ${name} <= ${num(u)}`);
  }
  if (bounds.length) out.push('Bounds', ...bounds);
  if (generals.length) out.push('Generals', ...generals.map((s) => ` ${s}`));
  if (binaries.length) out.push('Binaries', ...binaries.map((s) => ` ${s}`));
  out.push('End', '');
  return out.join('\n');
}

function isLpName(name: string): boolean {
  if (name.length === 0 || name.length > 255 || !NAME_START.test(name[0]!)) return false;
  for (const ch of name) if (!NAME_CHAR.test(ch)) return false;
  // A name that reads as a number (1e5) or a keyword would read back differently.
  if (/^[eE]\d/.test(name) || /^(inf|infinity|free)$/i.test(name)) return false;
  return !KEYWORDS.some(([re]) => re.test(name));
}

function lpName(name: string, what: string): void {
  if (!isLpName(name)) fail('LP_VALUE', `the ${what} name '${name}' can't be written in LP format`);
}

/** A number as the shortest text that reads back to it. */
export function num(v: number): string {
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  return String(v + 0);
}

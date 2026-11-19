/**
 * Reading MPS files (smaltworks ADR 0039, section 5): the column-oriented text format most solvers read and write,
 * in its free form (fields separated by spaces) and its fixed form (fields in set columns, so names may hold spaces).
 *
 * Sections: NAME, OBJSENSE, ROWS, COLUMNS (with integer MARKER lines), RHS, RANGES, BOUNDS and ENDATA. What the
 * reader can't represent fails with LP_UNSUPPORTED, and a line that breaks the format with LP_FORMAT, naming the line.
 *
 * Where the format's descriptions differ, this reader does what HiGHS's reader does (HiGHS 1.16.0, checked by the
 * compare tests, fixtures/compare.json):
 * - The first N row is the objective; later N rows are free rows, and are dropped.
 * - An RHS entry on the objective row sets the objective's constant to its negative.
 * - An UP bound below 0 leaves the lower bound as it is (0 by default), as HiGHS does; some readers make it −∞.
 * - A column between MARKER INTORG and INTEND with no bound at all is 0 to 1; once any bound is given, the other
 *   defaults to 0 or +∞ as for any column. BV is 0 to 1.
 * @module
 */
import { fail } from '../core/errors.ts';

/** A model as an MPS file describes it, in plain arrays. */
export interface MpsModel {
  name: string;
  sense: 'minimize' | 'maximize';
  objectiveName: string;
  /** The objective's constant term. */
  offset: number;
  /** The constraint rows' names, in file order. */
  rowNames: string[];
  /** Each row's range: rowLo[r] ≤ a_r x ≤ rowUp[r]. */
  rowLo: Float64Array;
  rowUp: Float64Array;
  /** The columns' (variables') names, in file order. */
  colNames: string[];
  /** The objective coefficient of each column. */
  c: Float64Array;
  colLo: Float64Array;
  colUp: Float64Array;
  /** Whether each column is integer. */
  integer: Uint8Array;
  /** The constraint matrix as triplets: entry k is value[k] at row[k], column col[k]. */
  entries: { row: Int32Array; col: Int32Array; value: Float64Array };
}

export interface MpsOptions {
  /** 'free' (the default) splits each line on spaces; 'fixed' reads the fields by column, so names may hold spaces. */
  format?: 'free' | 'fixed';
}

type Section = 'NAME' | 'OBJSENSE' | 'ROWS' | 'COLUMNS' | 'RHS' | 'RANGES' | 'BOUNDS' | 'ENDATA';
const SECTIONS = new Set<string>(['NAME', 'OBJSENSE', 'ROWS', 'COLUMNS', 'RHS', 'RANGES', 'BOUNDS', 'ENDATA']);

/** Reads an MPS file's text. */
export function readMps(text: string, options: MpsOptions = {}): MpsModel {
  if (typeof text !== 'string') fail('LP_PARAM', 'readMps takes the file\'s text, as a string');
  const format = options.format ?? 'free';
  if (format !== 'free' && format !== 'fixed') fail('LP_PARAM', `format is 'free' or 'fixed', not ${String(format)}`);

  let name = '';
  let sense: 'minimize' | 'maximize' = 'minimize';
  let objectiveName = '';
  let offset = 0;
  const rowIndex = new Map<string, number>();
  const rowType: string[] = [];
  const rowNames: string[] = [];
  const dropped = new Set<string>();
  const colIndex = new Map<string, number>();
  const colNames: string[] = [];
  const c: number[] = [];
  const integer: number[] = [];
  const ei: number[] = [];
  const ej: number[] = [];
  const ev: number[] = [];
  let rhs: number[] = [];
  const range = new Map<number, number>();
  const lo: number[] = [];
  const up: number[] = [];
  /** Whether any BOUNDS line named the column. */
  const bounded: boolean[] = [];
  let inInteger = false;
  const setNames: Record<string, string | undefined> = {};
  let section: Section | null = null;
  let ended = false;

  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln]!;
    const where = `line ${ln + 1}`;
    if (raw.trim() === '' || raw.startsWith('*')) continue;
    if (ended) fail('LP_FORMAT', `${where}: text after ENDATA`);

    // A section header starts in the first column.
    if (!/^\s/.test(raw)) {
      const parts = raw.trim().split(/\s+/);
      const key = parts[0]!.toUpperCase();
      if (!SECTIONS.has(key)) {
        if (key === 'OBJSENCE' || key === 'OBJNAME' || key === 'SOS' || key === 'QUADOBJ' || key === 'QMATRIX' || key === 'QSECTION' || key === 'QCMATRIX' || key === 'CSECTION' || key === 'INDICATORS' || key === 'GENCONS' || key === 'PWLOBJ') {
          fail('LP_UNSUPPORTED', `${where}: the ${key} section isn't supported`);
        }
        fail('LP_FORMAT', `${where}: '${parts[0]}' isn't an MPS section (NAME, OBJSENSE, ROWS, COLUMNS, RHS, RANGES, BOUNDS, ENDATA)`);
      }
      section = key as Section;
      if (section === 'NAME') name = format === 'fixed' ? raw.slice(14).trim() || (parts.slice(1).join(' ')) : parts.slice(1).join(' ');
      else if (section === 'OBJSENSE' && parts.length > 1) sense = senseOf(parts[1]!, where);
      else if (section === 'ENDATA') ended = true;
      else if (parts.length > 1 && section !== 'RHS' && section !== 'RANGES' && section !== 'BOUNDS') {
        fail('LP_FORMAT', `${where}: unexpected text after ${key}`);
      }
      continue;
    }

    if (section === null || section === 'NAME') fail('LP_FORMAT', `${where}: data before a section header`);
    if (section === 'OBJSENSE') {
      sense = senseOf(raw.trim(), where);
      continue;
    }
    if (section === 'ROWS') {
      const f = fields(raw, format, [[1, 3], [4, 12]]);
      if (f.length !== 2) fail('LP_FORMAT', `${where}: a ROWS line is a type (N, L, G or E) and a name`);
      const type = f[0]!.toUpperCase();
      const rn = f[1]!;
      if (type === 'N') {
        if (objectiveName === '') objectiveName = rn;
        else dropped.add(rn);
        continue;
      }
      if (type !== 'L' && type !== 'G' && type !== 'E') fail('LP_FORMAT', `${where}: row type '${f[0]}' isn't N, L, G or E`);
      if (rowIndex.has(rn) || rn === objectiveName) fail('LP_FORMAT', `${where}: row '${rn}' is defined twice`);
      rowIndex.set(rn, rowNames.length);
      rowNames.push(rn);
      rowType.push(type);
      continue;
    }
    if (section === 'COLUMNS') {
      if (/'MARKER'/i.test(raw)) {
        if (/'INTORG'/i.test(raw)) inInteger = true;
        else if (/'INTEND'/i.test(raw)) inInteger = false;
        else fail('LP_FORMAT', `${where}: a MARKER line is 'INTORG' or 'INTEND'`);
        continue;
      }
      const f = fields(raw, format, [[4, 12], [14, 22], [24, 36], [39, 47], [49, 61]]);
      if (f.length !== 3 && f.length !== 5) fail('LP_FORMAT', `${where}: a COLUMNS line is a column, then one or two pairs of row and value`);
      const cn = f[0]!;
      let j = colIndex.get(cn);
      if (j === undefined) {
        j = colNames.length;
        colIndex.set(cn, j);
        colNames.push(cn);
        c.push(0);
        integer.push(inInteger ? 1 : 0);
        lo.push(0);
        up.push(Infinity);
        bounded.push(false);
      } else if (colNames[colNames.length - 1] !== cn) {
        fail('LP_FORMAT', `${where}: column '${cn}' appears again after other columns; a column's entries must be together`);
      }
      for (let k = 1; k < f.length; k += 2) {
        const rn = f[k]!;
        const v = number(f[k + 1]!, where);
        if (rn === objectiveName) c[j]! += v;
        else if (dropped.has(rn)) continue;
        else {
          const r = rowIndex.get(rn);
          if (r === undefined) fail('LP_FORMAT', `${where}: row '${rn}' isn't in ROWS`);
          ei.push(r);
          ej.push(j);
          ev.push(v);
        }
      }
      continue;
    }
    if (section === 'RHS' || section === 'RANGES') {
      if (section === 'RHS' && rhs.length === 0) rhs = new Array<number>(rowNames.length).fill(0);
      const f = fields(raw, format, [[4, 12], [14, 22], [24, 36], [39, 47], [49, 61]]);
      // With a set name the line has 3 or 5 fields; free MPS may leave the name out (2 or 4).
      const named = f.length === 3 || f.length === 5;
      if (f.length < 2 || f.length > 5) fail('LP_FORMAT', `${where}: an ${section} line is a set name, then one or two pairs of row and value`);
      if (named) checkSet(setNames, section, f[0]!, where);
      for (let k = named ? 1 : 0; k < f.length; k += 2) {
        const rn = f[k]!;
        if (f[k + 1] === undefined) fail('LP_FORMAT', `${where}: row '${rn}' has no value`);
        const v = number(f[k + 1]!, where);
        if (rn === objectiveName) {
          if (section === 'RANGES') fail('LP_FORMAT', `${where}: the objective row can't have a range`);
          offset = -v;
          continue;
        }
        if (dropped.has(rn)) continue;
        const r = rowIndex.get(rn);
        if (r === undefined) fail('LP_FORMAT', `${where}: row '${rn}' isn't in ROWS`);
        if (section === 'RHS') rhs[r] = v;
        else range.set(r, v);
      }
      continue;
    }
    if (section === 'BOUNDS') {
      const f = fields(raw, format, [[1, 3], [4, 12], [14, 22], [24, 36]]);
      const type = (f[0] ?? '').toUpperCase();
      const needsValue = type === 'UP' || type === 'LO' || type === 'FX' || type === 'LI' || type === 'UI' || type === 'SC';
      const noValue = type === 'FR' || type === 'MI' || type === 'PL' || type === 'BV';
      if (!needsValue && !noValue) fail('LP_FORMAT', `${where}: bound type '${f[0]}' isn't UP, LO, FX, FR, MI, PL, BV, LI, UI or SC`);
      if (type === 'SC') fail('LP_UNSUPPORTED', `${where}: semi-continuous bounds (SC) aren't supported`);
      // A set name is there when the line has one field more than its type needs. BV may also carry a value, which
      // is ignored: "BV set col", "BV col 1" and "BV set col 1" all read.
      const base = needsValue ? 3 : 2;
      let k: number;
      if (type === 'BV' && f.length === 4) k = 2;
      else if (type === 'BV' && f.length === 3) k = colIndex.has(f[1]!) && !colIndex.has(f[2]!) ? 1 : 2;
      else if (f.length === base + 1) k = 2;
      else if (f.length === base) k = 1;
      else fail('LP_FORMAT', `${where}: a ${type} bound is ${needsValue ? 'a set name, a column and a value' : 'a set name and a column'}`);
      if (k === 2) checkSet(setNames, 'BOUNDS', f[1]!, where);
      const cn = f[k]!;
      const j = colIndex.get(cn);
      if (j === undefined) fail('LP_FORMAT', `${where}: column '${cn}' isn't in COLUMNS`);
      const v = needsValue ? number(f[k + 1]!, where) : 0;
      bounded[j] = true;
      switch (type) {
        case 'UP':
        case 'UI':
          up[j] = v;
          if (type === 'UI') integer[j] = 1;
          break;
        case 'LO':
        case 'LI':
          lo[j] = v;
          if (type === 'LI') integer[j] = 1;
          break;
        case 'FX':
          lo[j] = up[j] = v;
          break;
        case 'FR':
          lo[j] = -Infinity;
          up[j] = Infinity;
          break;
        case 'MI':
          lo[j] = -Infinity;
          break;
        case 'PL':
          up[j] = Infinity;
          break;
        case 'BV':
          lo[j] = 0;
          up[j] = 1;
          integer[j] = 1;
          break;
      }
      continue;
    }
  }
  if (!ended) fail('LP_FORMAT', 'the file has no ENDATA line');
  // Integer columns from the markers with no bound at all are binary, as HiGHS reads them.
  for (let j = 0; j < colNames.length; j++) if (integer[j] && !bounded[j]) up[j] = 1;
  if (objectiveName === '') fail('LP_FORMAT', 'ROWS has no N row: there is no objective');

  const m = rowNames.length;
  const rowLo = new Float64Array(m);
  const rowUp = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    const b = rhs[r] ?? 0;
    const t = rowType[r];
    const R = range.get(r);
    if (t === 'L') {
      rowLo[r] = R === undefined ? -Infinity : b - Math.abs(R);
      rowUp[r] = b;
    } else if (t === 'G') {
      rowLo[r] = b;
      rowUp[r] = R === undefined ? Infinity : b + Math.abs(R);
    } else {
      rowLo[r] = R !== undefined && R < 0 ? b + R : b;
      rowUp[r] = R !== undefined && R > 0 ? b + R : b;
    }
  }
  return {
    name, sense, objectiveName, offset, rowNames, rowLo, rowUp, colNames,
    c: Float64Array.from(c), colLo: Float64Array.from(lo), colUp: Float64Array.from(up), integer: Uint8Array.from(integer),
    entries: { row: Int32Array.from(ei), col: Int32Array.from(ej), value: Float64Array.from(ev) },
  };
}

function senseOf(word: string, where: string): 'minimize' | 'maximize' {
  const w = word.toUpperCase();
  if (w === 'MAX' || w === 'MAXIMIZE') return 'maximize';
  if (w === 'MIN' || w === 'MINIMIZE') return 'minimize';
  fail('LP_FORMAT', `${where}: OBJSENSE is MAX or MIN, not '${word}'`);
}

function number(s: string, where: string): number {
  const v = Number(s);
  if (s.trim() === '' || !Number.isFinite(v)) {
    if (/^[+-]?(inf|infinity|1e\+?30)$/i.test(s.trim())) return s.trim().startsWith('-') ? -Infinity : Infinity;
    fail('LP_FORMAT', `${where}: '${s}' isn't a number`);
  }
  // 1e30 and beyond stands for infinity in MPS files, as many solvers write it.
  if (Math.abs(v) >= 1e30) return v > 0 ? Infinity : -Infinity;
  return v;
}

/** The first RHS, RANGES or BOUNDS set is the one read; a second set name fails rather than mixing them. */
function checkSet(names: Record<string, string | undefined>, section: string, set: string, where: string): void {
  const first = names[section];
  if (first === undefined) names[section] = set;
  else if (first !== set) fail('LP_UNSUPPORTED', `${where}: a second ${section} set ('${set}', after '${first}') isn't supported`);
}

/**
 * A data line's fields. Free: split on spaces. Fixed: the 1-based column ranges given, trimmed; an empty field in the
 * middle (a blank set name) stays as '', and empty fields at the end are dropped.
 */
function fields(raw: string, format: 'free' | 'fixed', cols: readonly (readonly [number, number])[]): string[] {
  if (format === 'free') return raw.trim().split(/\s+/);
  const out = cols.map(([a, b]) => raw.slice(a, b).trim());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * A model as MPS text, free (the default) or fixed, which {@link readMps} and HiGHS read back to the same model (the
 * compare tests check HiGHS's reading).
 * - A row with only an upper side is L, only a lower side G, both equal E, both finite and different L with a RANGES
 *   entry; a row with neither side is a free N row, which readers (this one and HiGHS's) drop.
 * - The objective's constant is the objective row's RHS entry, negated, as the reader takes it.
 * - Integer columns sit between MARKER lines; an integer column from 0 to 1 is BV, and one from 0 with no upper bound
 *   gets an explicit LO 0, since an integer column with no bounds reads as 0 to 1.
 * - Free format: names may not hold spaces. Fixed: names are at most 8 characters and numbers at most 12; one that
 *   doesn't fit fails with LP_VALUE rather than being cut.
 */
export function writeMps(model: MpsModel, options: MpsOptions = {}): string {
  const format = options.format ?? 'free';
  if (format !== 'free' && format !== 'fixed') fail('LP_PARAM', `format is 'free' or 'fixed', not ${String(format)}`);
  const fixed = format === 'fixed';
  const name = (s: string, what: string): string => {
    if (s === '' || /\s/.test(s) && !fixed) fail('LP_VALUE', `the ${what} name '${s}' can't be written in free MPS: it is empty or holds a space`);
    if (fixed && (s.length > 8 || s.trim() !== s)) fail('LP_VALUE', `the ${what} name '${s}' can't be written in fixed MPS: names are at most 8 characters`);
    return s;
  };
  const value = (v: number): string => {
    const t = String(v + 0);
    if (fixed && t.length > 12) fail('LP_VALUE', `the number ${t} doesn't fit fixed MPS's 12 characters; write free MPS instead`);
    return t;
  };
  /** A data line: in fixed format, each field at its set columns (2, 5, 15, 25, 40, 50, counting from 1). */
  const line = (code: string, ...f: string[]): string => {
    if (!fixed) return ` ${[code, ...f].filter((x) => x !== '').join(' ')}`;
    const starts = code === '' ? [4, 14, 24, 39, 49] : [1, 4, 14, 24, 39, 49];
    const parts = code === '' ? f : [code, ...f];
    let s = '';
    parts.forEach((x, k) => (s = s.padEnd(starts[k]!) + x));
    return s.trimEnd();
  };
  const objName = name(model.objectiveName || 'obj', 'objective');
  model.colNames.forEach((s) => name(s, 'column'));
  model.rowNames.forEach((s) => name(s, 'row'));
  const out: string[] = [fixed ? `NAME          ${model.name}` : `NAME ${model.name}`.trimEnd()];
  if (model.sense === 'maximize') out.push('OBJSENSE', '    MAX');
  out.push('ROWS', line('N', objName));
  const kind = model.rowNames.map((_, r) => {
    const l = model.rowLo[r]!;
    const u = model.rowUp[r]!;
    return l === -Infinity && u === Infinity ? 'N' : l === u ? 'E' : l === -Infinity ? 'L' : u === Infinity ? 'G' : 'L';
  });
  model.rowNames.forEach((r, i) => out.push(line(kind[i]!, r)));
  out.push('COLUMNS');
  const byCol: [number, number][][] = model.colNames.map(() => []);
  const { row, col, value: val } = model.entries;
  for (let k = 0; k < val.length; k++) if (val[k] !== 0) byCol[col[k]!]!.push([row[k]!, val[k]!]);
  let inInt = false;
  let marker = 0;
  model.colNames.forEach((cn, j) => {
    const isInt = model.integer[j] === 1;
    if (isInt !== inInt) {
      const m = `MARKER${String(marker++).padStart(fixed ? 2 : 1, '0')}`;
      out.push(fixed ? line('', m, "'MARKER'", '', isInt ? "'INTORG'" : "'INTEND'") : `    ${m} 'MARKER' ${isInt ? "'INTORG'" : "'INTEND'"}`);
      inInt = isInt;
    }
    const pairs: [string, number][] = [];
    if (model.c[j] !== 0) pairs.push([objName, model.c[j]!]);
    for (const [r, v] of byCol[j]!) pairs.push([model.rowNames[r]!, v]);
    // A column with no entries at all still has to be named.
    if (pairs.length === 0) pairs.push([objName, 0]);
    for (const [rn, v] of pairs) out.push(line('', cn, rn, value(v)));
  });
  if (inInt) out.push(fixed ? line('', `MARKER${String(marker).padStart(2, '0')}`, "'MARKER'", '', "'INTEND'") : `    MARKER${marker} 'MARKER' 'INTEND'`);
  const rhs: string[] = [];
  if (model.offset !== 0) rhs.push(line('', 'RHS', objName, value(-model.offset)));
  const ranges: string[] = [];
  model.rowNames.forEach((rn, r) => {
    const l = model.rowLo[r]!;
    const u = model.rowUp[r]!;
    const b = kind[r] === 'G' ? l : kind[r] === 'N' ? 0 : u;
    if (b !== 0) rhs.push(line('', 'RHS', rn, value(b)));
    if (kind[r] === 'L' && l !== -Infinity) ranges.push(line('', 'RNG', rn, value(u - l)));
  });
  if (rhs.length) out.push('RHS', ...rhs);
  if (ranges.length) out.push('RANGES', ...ranges);
  const bounds: string[] = [];
  model.colNames.forEach((cn, j) => {
    const l = model.colLo[j]!;
    const u = model.colUp[j]!;
    const isInt = model.integer[j] === 1;
    const b = (type: string, v?: number) => bounds.push(line(type, 'BND', cn, v === undefined ? '' : value(v)));
    if (isInt && l === 0 && u === 1) return b('BV');
    if (l === u) return b('FX', l);
    if (l === -Infinity && u === Infinity) return b('FR');
    if (l === -Infinity) b('MI');
    else if (l !== 0 || isInt || u < 0) b('LO', l);
    if (u !== Infinity) b('UP', u);
  });
  if (bounds.length) out.push('BOUNDS', ...bounds);
  out.push('ENDATA', '');
  return out.join('\n');
}

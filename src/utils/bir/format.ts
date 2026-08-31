/**
 * Output formatting for the BIR reports.
 *
 * Two halves, both concerned with how numbers reach a reader: the receipt text
 * formatters, and the TOTAL row appended to every exported sheet.
 */

/* ------------------------------------------------------------------ *
 * Receipt text
 *
 * Ported verbatim from the mobile app (utakmobileBIR/src/mod_temp_bir/
 * formatters/* and utils/pipe.ts) so the web reading() renderer produces
 * byte-identical output.
 * ------------------------------------------------------------------ */

export function alignMiddle(out: string, width: number): string {
  const text = (out ?? '').toString();
  const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  return text.padStart(Math.floor((width + visibleLength) / 2), ' ');
}

export function alignRight(out: string, width: number): string {
  const text = (out ?? '').toString();
  const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  return text.padStart(width - visibleLength + text.length, ' ');
}

export function newline(out: string): string {
  return out + '\n';
}

export function bold(out: string): string {
  return `\x1BE\x01${out}\x1BE\x00`;
}

const MAPPINGS: [string, RegExp][] = Object.entries({
  '': /\r/g,
  '1/4': /¼/g,
  '1/2': /½/g,
  '3/4': /¾/g,
  '1/7': /⅐/g,
  '1/9': /⅑/g,
  '1/10': /⅒/g,
  '1/3': /⅓/g,
  '2/3': /⅔/g,
  '1/5': /⅕/g,
  '2/5': /⅖/g,
  '3/5': /⅗/g,
  '4/5': /⅘/g,
  '1/6': /⅙/g,
  '5/6': /⅚/g,
  '1/8': /⅛/g,
  '3/8': /⅜/g,
  '5/8': /⅝/g,
  '7/8': /⅞/g,
}) as [string, RegExp][];

export function normalize(out: string): string {
  return MAPPINGS.reduce(
    (acc, [replaceValue, searchValue]) => acc.replace(searchValue, replaceValue),
    out,
  );
}

export function fixnum(num: number | string, { long = false }: { long?: boolean } = {}): string {
  if (num == 0) num = 0;
  // Round to nearest 0.01 (cents). Thousands separators are stripped first: the
  // output of this function is 0,000.00, so a value that has already been
  // formatted once would otherwise parse as its first group only
  // ("1,234.56" -> 1) and lose its magnitude.
  const parsed = parseFloat(String(num).replace(/,/g, '')) || 0;
  const rounded = Math.round(parsed * 100) / 100;
  num = rounded.toFixed(2);
  const [whole, unwhole] = num.split('.');
  const delimitedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return !long && unwhole === '00' ? delimitedWhole : `${delimitedWhole}.${unwhole}`;
}

/**
 * Re-format the given column indexes of a sheet's data rows (row 0 is the
 * header) as 0,000.00 money strings.
 */
export function formatMoneyColumns<T extends any[]>(rows: T[], moneyCols: number[]): T[] {
  return rows.map((row, i) => {
    if (i === 0 || !Array.isArray(row)) return row;
    const next = [...row] as T;
    for (const c of moneyCols) {
      const v = next[c];
      if (v === '' || v == null) continue;
      next[c] = fixnum(v, { long: true }) as any;
    }
    return next;
  });
}

export function money(
  num: number | string,
  { long = false, currency = 'PHP' }: { long?: boolean; currency?: string } = {},
): string {
  // Round to nearest 0.01 (cents)
  const parsed = Number(num) || 0;
  const rounded = Math.round(parsed * 100) / 100;
  const asMoney = rounded.toFixed(2);
  // NOTE: this prevents: -0 -> 'P-0.00'
  if (Number(asMoney) === 0) num = 0;

  if (typeof num !== 'string') {
    if (typeof num !== 'number' || isNaN(num)) return currency;
  }
  return currency + ' ' + fixnum(num, { long });
}

type UnaryFunction = (source: any) => any;

export function pipe(...fns: UnaryFunction[]): UnaryFunction {
  if (fns.length === 0) return (x: any) => x;
  if (fns.length === 1) return fns[0];
  return (input: any) => fns.reduce((prev, fn) => fn(prev), input);
}

/* ------------------------------------------------------------------ */

/**
 * Totals row for the exported reports.
 *
 * Every CSV/Excel report ends with a TOTAL row summing its numeric columns, so
 * a reader does not have to sum a sheet by hand to reconcile against a
 * Z-reading.
 *
 * Two kinds of column are deliberately excluded, because summing them produces
 * a meaningless number:
 *
 *   - running / accumulated columns, which are already cumulative (summing a
 *     running total double-counts every earlier row)
 *   - identifiers and labels — dates, SI numbers, counters, cashier names
 *
 * Identifier columns are matched by header rather than by value, since an SI
 * number or a receipt counter is numeric but must never be added up.
 */

/** Label placed in the first column of the totals row. */
export const TOTAL_LABEL = 'TOTAL';

/**
 * Headers that are cumulative by nature. Summing these is always wrong.
 */
const RUNNING_PATTERNS = [
  /running/i,
  /accumulated/i,
  /\bacc\.?\s/i,
  /grand total/i,
  /present\s+acc/i,
  /previous\s+acc/i,
];

/**
 * Headers that are numeric but are identifiers, not quantities.
 */
const IDENTIFIER_PATTERNS = [
  /^date$/i,
  /^time$/i,
  /\bno\.?$/i,
  /\bnumber$/i,
  /^si\b/i,
  /receipt\s*(no|cycle)/i,
  /counter/i,
  /^type$/i,
  /^cashier$/i,
  /^remarks$/i,
  /^payment\s*type/i,
  /^status$/i,
  /\bid\b/i,
  /\btin\b/i,
  /^reset\b/i,
  /^z-?counter$/i,
  /birth\s*date/i,
  /^tin$/i,
  /^branch$/i,
  /^month$/i,
  /^year$/i,
  /^min$/i,
];

const matchesAny = (header: string, patterns: RegExp[]) =>
  patterns.some(re => re.test(String(header || '').trim()));

/** True when a column header should be excluded from the totals row. */
export const isExcludedColumn = (header: string): boolean =>
  matchesAny(header, RUNNING_PATTERNS) || matchesAny(header, IDENTIFIER_PATTERNS);

/**
 * Parse a cell to a number, or null when it is not numeric.
 *
 * Report cells arrive as numbers, numeric strings, or formatted strings with
 * thousands separators, so all three are handled. Empty cells count as zero
 * only when the column has at least one real number elsewhere.
 */
export function toNumber(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;

  const trimmed = cell.trim();
  if (!trimmed) return null;

  // Parenthesised negatives, e.g. "(45.00)".
  const negative = /^\(.*\)$/.test(trimmed);
  const inner = trimmed.replace(/^\(|\)$/g, '');

  // Drop only currency symbols, thousands separators and spaces. Anything else
  // left over (slashes, colons, letters) means this is not a number — a date
  // like "07/22/2026" must never sum, even if a header pattern misses it.
  const cleaned = inner.replace(/[,\s\u00A0]/g, '').replace(/^[^\d.-]+/, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Append a totals row to a sheet whose first row is the header.
 *
 * Returns a new array; the input is not mutated. A sheet with no data rows is
 * returned unchanged — a TOTAL row under an empty report is just noise.
 */
export function appendTotalsRow(
  rows: any[][],
  options: { label?: string; excludeHeaders?: string[] } = {},
): any[][] {
  if (!Array.isArray(rows) || rows.length < 2) return rows;

  const [header, ...dataRows] = rows;
  if (!Array.isArray(header)) return rows;

  const label = options.label ?? TOTAL_LABEL;
  const extraExcluded = (options.excludeHeaders || []).map(h =>
    String(h).trim().toLowerCase(),
  );

  const width = header.length;
  const totals: (number | null)[] = new Array(width).fill(null);

  for (let col = 0; col < width; col++) {
    const name = String(header[col] ?? '');
    if (isExcludedColumn(name)) continue;
    if (extraExcluded.includes(name.trim().toLowerCase())) continue;

    let sum = 0;
    let sawNumber = false;
    for (const row of dataRows) {
      const n = toNumber(Array.isArray(row) ? row[col] : undefined);
      if (n === null) continue;
      sum += n;
      sawNumber = true;
    }
    if (sawNumber) totals[col] = sum;
  }

  // Round to two decimals: the summed cells are money, and floating-point
  // accumulation otherwise surfaces artefacts like 1234.5600000000002.
  const totalsRow: any[] = totals.map(v =>
    v === null ? '' : Math.round(v * 100) / 100,
  );

  // Place the label in the first column that carries no total, so it never
  // overwrites a summed value. If every column is numeric the sums win — a
  // missing label is recoverable, a missing total is not.
  const labelCol = totals.findIndex(v => v === null);
  if (labelCol !== -1) totalsRow[labelCol] = label;

  return [...rows, totalsRow];
}

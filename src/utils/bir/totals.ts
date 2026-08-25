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

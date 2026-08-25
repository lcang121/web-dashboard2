/**
 * Receipt text formatters ported verbatim from the mobile app
 * (utakmobileBIR/src/mod_temp_bir/formatters/* and utils/pipe.ts) so the web
 * reading() renderer produces byte-identical output.
 */

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

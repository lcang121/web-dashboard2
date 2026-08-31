/**
 * Differential parity test: runs the web port and the mobile app's own
 * HelperFunctions over the same fixture and asserts identical output.
 *
 * The mobile repo is the source of truth for every BIR figure, so this is the
 * check that matters when re-syncing. It self-skips when the sibling checkout is
 * absent (CI, a fresh clone), so it can never fail for the wrong reason.
 *
 * Point it at a different checkout with UTAK_MOBILE_ROOT=/path/to/utakmobileBIR.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Moment from 'moment-timezone';

import { getTransactionSummary } from './transaction';
import { calcReadingData } from './calcReadingData';
import { specialDiscounts } from './specialDiscounts';

const MOBILE_ROOT = process.env.UTAK_MOBILE_ROOT || '/Users/martinjaycyhalum/Developer/utakmobileBIR';
const FIXTURE = path.join(MOBILE_ROOT, 'transactions_list_non_reversed_new.json');
const MOBILE_READING = path.join(MOBILE_ROOT, 'src/mod_temp_bir/receipts/reading.ts');
const MOBILE_TXN = path.join(MOBILE_ROOT, 'src/HelperFunctions/transaction.js');
const MOBILE_SPECIAL_DISCOUNTS = path.join(MOBILE_ROOT, 'src/mod_temp_bir/csvs/specialDiscounts.ts');

const available = [FIXTURE, MOBILE_READING, MOBILE_TXN, MOBILE_SPECIAL_DISCOUNTS].every(f =>
  fs.existsSync(f),
);

/** Minimal stand-in for a Firebase DataSnapshot over a keyed record. */
const asSnapshot = (record: Record<string, any>) => ({
  exists: () => Object.keys(record).length > 0,
  forEach: (cb: (snap: { key: string; val: () => any }) => void) => {
    for (const [key, val] of Object.entries(record)) cb({ key, val: () => val });
  },
});

/** Round every number in a structure so float tails don't mask real agreement. */
const round = (v: any): any => {
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, round(val)]));
  }
  return v;
};

/**
 * The device's reading.ts imports the settings observable, which drags in
 * Firebase and AsyncStorage and is unloadable here. calcReadingData itself is
 * self-contained, so slice it out verbatim and supply its two local helpers.
 */
function extractMobileCalcReadingData(): string {
  const src = fs.readFileSync(MOBILE_READING, 'utf8');
  const start = src.indexOf('export const calcReadingData');
  expect(start, 'calcReadingData not found in the device reading.ts').toBeGreaterThan(-1);
  // The declaration ends at the first line that closes it at column 0.
  const end = src.indexOf('\n};', start);
  expect(end, 'calcReadingData body is unterminated').toBeGreaterThan(start);
  const body = src.slice(start, end + 3);

  const preamble = [
    "import { sumBy, first, last } from 'lodash-es';",
    'const normalizeNumber = (n: any) => {',
    '  const r = Math.round(n * 100) / 100;',
    "  return Number.isInteger(r) ? r.toString().replace(/[,;:\\t]/g, '') : r.toFixed(2).replace(/[,;:\\t]/g, '');",
    '};',
  ].join('\n');

  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'bir-parity-')),
    'mobileCalcReadingData.ts',
  );
  fs.writeFileSync(file, `${preamble}\n${body}\n`);
  return file;
}

/**
 * The device's specialDiscounts.ts is self-contained apart from its imports, so
 * it loads as-is once those are pointed at this repo's own models and helpers —
 * the same substitution the port makes. Everything below the import block is
 * the device's code, untouched, including its `global.C` rate lookups.
 */
function rewriteMobileSpecialDiscounts(): string {
  const src = fs.readFileSync(MOBILE_SPECIAL_DISCOUNTS, 'utf8');
  const abs = (rel: string) => path.resolve(process.cwd(), rel);
  const [head, ...rest] = [src.slice(0, src.indexOf('const MP =')), src.slice(src.indexOf('const MP ='))];
  expect(rest.length, 'specialDiscounts.ts has no MP declaration').toBe(1);
  expect(head, 'unexpected import block').toContain("from '../vendor/moment'");

  const imports = [
    "import Moment from 'moment-timezone';",
    "import { sortBy } from 'lodash-es';",
    `import Transaction from '${abs('src/models/Transaction')}';`,
    `import TransactionItem from '${abs('src/models/TransactionItem')}';`,
    `import { getTransactionSummary } from '${abs('src/utils/bir/transaction')}';`,
    `import { getRefundSummary, getReturnSummary, getVoidSummary } from '${abs('src/utils/bir/refund')}';`,
    'type DataSnapshot = any;',
  ].join('\n');

  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'bir-parity-sd-')),
    'mobileSpecialDiscounts.ts',
  );
  fs.writeFileSync(file, `${imports}\n${rest[0]}`);
  return file;
}

describe.skipIf(!available)('web ↔ mobile computation parity', () => {
  let fixture: Record<string, any>;
  let mobileGetTransactionSummary: (s: any) => any[];
  let mobileCalcReadingData: (...args: any[]) => Promise<any>;
  let mobileSpecialDiscounts: (opts: any) => Promise<any>;

  beforeAll(async () => {
    fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

    // The device reads its rates off a global; the web port inlines them.
    (globalThis as any).C = {
      VAT_RATE: 0.12,
      SENIOR_RATE: 0.2,
      PWD_RATE: 0.2,
      NAAC_RATE: 0.2,
      SOLO_PARENT_RATE: 0.1,
      MEDAL_OF_VALOR_RATE: 0.2,
      COMMODITY_RATE: 0.05,
    };
    (globalThis as any).global = globalThis;

    mobileGetTransactionSummary = (await import(/* @vite-ignore */ MOBILE_TXN)).getTransactionSummary;
    mobileCalcReadingData = (
      await import(/* @vite-ignore */ extractMobileCalcReadingData())
    ).calcReadingData;
    mobileSpecialDiscounts = (
      await import(/* @vite-ignore */ rewriteMobileSpecialDiscounts())
    ).specialDiscounts;
  });

  it('getTransactionSummary matches the device for every transaction', () => {
    const web = getTransactionSummary(asSnapshot(fixture));
    const mobile = mobileGetTransactionSummary(asSnapshot(fixture));

    expect(web.length).toBe(mobile.length);
    expect(web.length).toBeGreaterThan(0);
    expect(round(web)).toEqual(round(mobile));
  });

  it('specialDiscounts matches the device for all seven Annex sheets', async () => {
    // Start of the month the fixture's earliest transaction falls in — the
    // device uses it to split each total into current- and prior-month parts.
    const earliest = Math.min(...Object.keys(fixture).map(Number));
    const month = Moment.unix(earliest).startOf('month').format('X');
    const args = { snapshot: asSnapshot(fixture), month };

    const web = await specialDiscounts(args);
    const mobile = await mobileSpecialDiscounts(args);

    for (const sheet of ['sheet1', 'sheet2', 'sheet3', 'sheet4', 'sheet5', 'sheet6', 'sheet7']) {
      expect(round((web as any)[sheet]), `${sheet} differs from the device`).toEqual(
        round((mobile as any)[sheet]),
      );
    }
    // A fixture that produced only header rows would make the above vacuous.
    const rowCount = ['sheet1', 'sheet2', 'sheet3', 'sheet4', 'sheet5', 'sheet6', 'sheet7'].reduce(
      (n, s) => n + (web as any)[s].length - 1,
      0,
    );
    expect(rowCount, 'fixture produced no discount rows at all').toBeGreaterThan(0);
  });

  it('specialDiscounts matches the device on the Medal of Valor sheet', async () => {
    // The device's fixture has no MOV sale, so the sheet7 path above compares
    // headers only. Synthesize one by adding a Medal of Valor block to the
    // fixture's PAX transaction — MOV rides the same _parts machinery as SC/PWD.
    const [paxKey, paxTxn] = Object.entries(fixture).find(([, v]: [string, any]) => {
      const items = Array.isArray(v.items) ? v.items : Object.values(v.items || {});
      return items.some((i: any) => i?.paxDiscount);
    })!;
    const withMov = JSON.parse(JSON.stringify(paxTxn));
    const movItems = Array.isArray(withMov.items) ? withMov.items : Object.values(withMov.items);
    (movItems as any[]).find((i: any) => i?.paxDiscount).paxDiscount.medalOfValor = {
      tins: '', percent: 20, names: 'Juan Dela Cruz', ids: 'MOV-1', guestCount: 1,
    };
    const record = { [paxKey]: withMov };
    const args = {
      snapshot: asSnapshot(record),
      month: Moment.unix(Number(paxKey)).startOf('month').format('X'),
    };

    const web = await specialDiscounts(args);
    const mobile = await mobileSpecialDiscounts(args);

    expect((web as any).sheet7.length, 'no Medal of Valor row was produced').toBeGreaterThan(1);
    for (const sheet of ['sheet1', 'sheet2', 'sheet3', 'sheet4', 'sheet5', 'sheet6', 'sheet7']) {
      expect(round((web as any)[sheet]), `${sheet} differs from the device`).toEqual(
        round((mobile as any)[sheet]),
      );
    }
  });

  it('calcReadingData matches the device over the same summary', async () => {
    const summary = getTransactionSummary(asSnapshot(fixture));
    const web = calcReadingData(summary as any, [], undefined, undefined, null);
    const mobile = await mobileCalcReadingData(summary as any, [] as any, undefined, undefined, null);

    // vatPayable is a web-only convenience field the device does not emit.
    const { vatPayable: _webOnly, ...webComparable } = web as any;
    expect(round(webComparable)).toEqual(round(mobile));
  });
});

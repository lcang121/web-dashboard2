import { groupBy, sumBy, first, last, sortBy } from 'lodash-es';
import Moment from 'moment-timezone';

import { getTransactionSummary } from './transaction';
import { calcReadingData } from './calcReadingData';
import { appendTotalsRow } from './format';

const VAT_RATE = 0.12;
const SENIOR_RATE = 0.2;
const PWD_RATE = 0.2;
const MEDAL_OF_VALOR_RATE = 0.2;
const ACCUMULATED_SALES_RESET_THRESHOLD = 10000000000;

/** Round to 2dp and strip CSV-hostile chars, matching the mobile app's number helper. */
const normalizeNumber = (n: number | string): string => {
  const rounded = Math.round((Number(n) || 0) * 100) / 100;
  if (Number.isInteger(rounded)) return rounded.toString().replace(/[,;:\t]/g, '');
  return rounded.toFixed(2).replace(/[,;:\t]/g, '');
};

/** Format SI/OR with cycle: XX-YYYYYY for Beginning/Ending columns. */
const formatReceiptNoWithCycle = (
  cycle: number | string | undefined | null,
  no: string | number | undefined | null,
): string => {
  if (no === undefined || no === null || no === '') return '';
  const c = String(cycle ?? 0).padStart(2, '0');
  const n = Math.max(0, parseInt(String(no), 10) || 0);
  return `${c}-${String(n).padStart(6, '0')}`;
};

interface VoidLike {
  key?: string;
  originalTransactionKey?: string;
  amount?: number;
  voidBase?: number;
  voidVat?: number;
  isCancel?: boolean;
}

export interface SalesSummaryResult {
  sheet1: any[][];
  sheetBreakdown: any[][];
}

/**
 * BIR Sales Summary (Annex E-1), per-day rows. Ported from the mobile app
 * (utakmobileBIR/src/mod_temp_bir/csvs/salesSummary.ts) so web output matches
 * the device column-for-column. Returns raw data rows (no header block); the
 * caller prepends the title/meta/column header.
 */
export const SalesSummary = ({
  txnSnapshot,
  startingAccumBalance = 0,
  returnSummary,
  refundSummary,
  voidSummary,
  zCounters,
  overrunByDate,
  resetNoByDate,
  zReadNo = 0,
  consolidate = false,
}: {
  txnSnapshot: any;
  startingAccumBalance?: number;
  returnSummary?: any;
  refundSummary?: any;
  voidSummary?: { totalVoids?: number; totalVoidBase?: number; totalVoidVat?: number; voids?: VoidLike[] };
  zCounters?: Record<string, number>;
  overrunByDate?: Record<string, number>;
  resetNoByDate?: Record<string, number>;
  /** Current global zReadNo, fallback for days without a per-date zCounter. */
  zReadNo?: number;
  consolidate?: boolean;
}): SalesSummaryResult => {
  const txnSummary = getTransactionSummary(txnSnapshot);
  const groupedTxnSummary = groupBy(txnSummary, 'date');

  const sheet1: any[][] = [];
  const sheetBreakdown: any[][] = [];

  let index = 0;
  let prevGrandAccumBeginningBalance = Number(startingAccumBalance) || 0;

  // ── Breakdown sheet: one row per transaction, ordered by SI number ──
  sheetBreakdown.push(['Date', 'SI No', 'Type', 'Sales', 'VAT Amount', 'Discounts', 'Payment Type']);
  const breakdownTxns = [...txnSummary].sort((a: any, b: any) => {
    const cycleDiff = (Number(a.receiptCycle) || 0) - (Number(b.receiptCycle) || 0);
    if (cycleDiff !== 0) return cycleDiff;
    return (Number(a.receiptNo) || 0) - (Number(b.receiptNo) || 0);
  });
  for (const txn of breakdownTxns as any[]) {
    let type = 'Non-VAT';
    if (txn.vatableSales > 0) type = 'VAT';
    else if (txn.vatExemptSales > 0) type = 'VAT Exempt';
    else if (txn.zeroRatedSales > 0) type = 'VAT Zero-Rated';
    sheetBreakdown.push([
      Moment(txn.date, 'YYYY-MM-DD').format('MM/DD/YYYY'),
      formatReceiptNoWithCycle(txn.receiptCycle, txn.receiptNo),
      type,
      // normalizeNumber (not toFixed) so the report can apply the 0,000.00 cell
      // format; XLSX still stores the full-precision value.
      normalizeNumber(
        txn.grossSales ??
          ((txn.vatableSales || 0) + (txn.vatAmount || 0) + (txn.vatExemptSales || 0) + ((txn.zeroRatedSales || 0) * (1 + VAT_RATE))),
      ),
      normalizeNumber(txn.vatAmount || 0),
      (txn.deductions?.discount?.sc || 0) + (txn.deductions?.discount?.pwd || 0) + (txn.deductions?.discount?.naac || 0) +
        (txn.deductions?.discount?.soloParent || 0) + (txn.deductions?.discount?.others || 0),
      Object.keys(txn.paymentTypeTotals || {}).join(', '),
    ]);
  }

  // ── Per-date filters (align each day with its Z-reading) ──
  const filterVoidSummaryByDate = (vs: typeof voidSummary, date: string): number => {
    if (!vs?.voids?.length) return 0;
    return vs.voids
      .filter((v) => {
        if ((v as any).isCancel) return false;
        const ts = v.originalTransactionKey || v.key || '0';
        return Moment.unix(parseInt(String(ts), 10)).format('YYYY-MM-DD') === date;
      })
      .reduce((s, v) => s + (v.voidBase ?? v.amount ?? 0), 0);
  };
  const filterVoidVatByDate = (vs: typeof voidSummary, date: string): number => {
    if (!vs?.voids?.length) return 0;
    return vs.voids
      .filter((v) => {
        if ((v as any).isCancel) return false;
        const ts = v.originalTransactionKey || v.key || '0';
        return Moment.unix(parseInt(String(ts), 10)).format('YYYY-MM-DD') === date;
      })
      .reduce((s, v) => s + (v.voidVat ?? 0), 0);
  };
  const filterReturnSummaryByDate = (rs: any, date: string) => {
    if (!rs?.returns?.length) return rs;
    const filtered = (rs.returns as any[]).filter(
      (r) => Moment.unix(parseInt(String(r.key || 0), 10)).format('YYYY-MM-DD') === date,
    );
    if (filtered.length === 0) {
      return {
        ...rs,
        returns: [],
        totalReturnAmount: 0,
        returnBaseAmount: 0,
        returnNetAmount: 0,
        count: 0,
        totalScReturnDiscount: 0,
        totalPwdReturnDiscount: 0,
        totalMovReturnDiscount: 0,
        totalReturnVatExemptSales: 0,
        cashReturnAmount: 0,
        cashReturnNetAmount: 0,
        scReturnVatAdj: 0,
        pwdReturnVatAdj: 0,
        movReturnVatAdj: 0,
        regDiscReturnVatAdj: 0,
        zeroRatedReturnVatAdj: 0,
        vatOnReturns: 0,
      };
    }
    const returnBaseAmount = filtered.reduce(
      (s, r) => s + (r.vatableSales || 0) + (r.vatExemptSales || 0) + (r.zeroRatedSales || 0), 0);
    const totalReturnAmount = filtered.reduce((s, r) => s + (r.returnAmount || 0), 0);
    const returnNetAmount = filtered.reduce((s, r) => {
      const base = Math.abs((r.vatableSales || 0) + (r.vatExemptSales || 0) + (r.zeroRatedSales || 0));
      return s + (base - (r.scReturnDiscount || 0) - (r.pwdReturnDiscount || 0) - (r.movReturnDiscount || 0));
    }, 0);
    const totalScReturnDiscount = filtered.reduce((s, r) => s + (r.scReturnDiscount || 0), 0);
    const totalPwdReturnDiscount = filtered.reduce((s, r) => s + (r.pwdReturnDiscount || 0), 0);
    const totalMovReturnDiscount = filtered.reduce((s, r) => s + (r.movReturnDiscount || 0), 0);
    const totalReturnVatExemptSales = filtered.reduce((s, r) => s + Math.abs(r.vatExemptSales || 0), 0);
    const cashReturns = filtered.filter((r) => r.paymentType === 'Cash');
    const cashReturnAmount = cashReturns.reduce((s, r) => s + (r.returnAmount || 0), 0);
    const cashReturnNetAmount = cashReturns.reduce((s, r) => {
      const base = Math.abs((r.vatableSales || 0) + (r.vatExemptSales || 0) + (r.zeroRatedSales || 0));
      return s + (base - (r.scReturnDiscount || 0) - (r.pwdReturnDiscount || 0) - (r.movReturnDiscount || 0));
    }, 0);
    const regDiscReturnVatAdj = filtered.reduce((s, r) => s + (r.regDiscReturnVat || 0), 0);
    const zeroRatedReturnVatAdj = filtered.reduce((s, r) => s + (r.zeroRatedReturnBase || 0), 0) * VAT_RATE;
    const vatOnReturns = filtered.reduce((s, r) => s + (r.vatAmount || 0), 0);
    return {
      ...rs,
      returns: filtered,
      totalReturnAmount,
      returnBaseAmount,
      returnNetAmount: Math.max(0, returnNetAmount),
      count: filtered.length,
      totalScReturnDiscount,
      totalPwdReturnDiscount,
      totalMovReturnDiscount,
      totalReturnVatExemptSales,
      cashReturnAmount,
      cashReturnNetAmount,
      scReturnVatAdj: totalScReturnDiscount * (VAT_RATE / SENIOR_RATE),
      pwdReturnVatAdj: totalPwdReturnDiscount * (VAT_RATE / PWD_RATE),
      movReturnVatAdj: totalMovReturnDiscount * (VAT_RATE / MEDAL_OF_VALOR_RATE),
      regDiscReturnVatAdj,
      zeroRatedReturnVatAdj,
      vatOnReturns,
    };
  };
  const filterRefundSummaryByDate = (refs: any[], date: string) =>
    Array.isArray(refs) ? refs.filter((r) => r.date === date) : [];

  // ── One row per day ──
  for (const [key, value] of Object.entries(groupedTxnSummary)) {
    const rows = value as any[];
    const beginningReceiptNo = (first(rows) as any).receiptNo;
    const beginningReceiptCycle = (first(rows) as any).receiptCycle;
    const endingReceiptNo = (last(rows) as any).receiptNo;
    const endingReceiptCycle = (last(rows) as any).receiptCycle;

    const dateRefundSummary = filterRefundSummaryByDate(refundSummary || [], key);
    const dateReturnSummary = returnSummary ? filterReturnSummaryByDate(returnSummary, key) : undefined;
    const rd = calcReadingData(rows as any, dateRefundSummary as any, dateReturnSummary as any, {
      totalVoidVat: filterVoidVatByDate(voidSummary, key),
    } as any);

    const grossSales = Number(rd.grossSalesBeforeDiscount ?? rd.grossSales) || 0;
    const vatableSales = Number(rd.vatableSales) || 0;
    const vatAmount = Number(rd.vatAmount) || 0;
    const vatExemptSales = Number(rd.vatExemptSales) || 0;
    const zeroRatedSales = Number(rd.zeroRatedSales) || 0;

    const manualSalesForDay = sumBy(
      rows.filter((i) => String(i.manualReference || '').trim() !== ''),
      (i: any) =>
        i.grossSales ??
        ((i.vatableSales || 0) + (i.vatAmount || 0) + (i.vatExemptSales || 0) + ((i.zeroRatedSales || 0) * (1 + VAT_RATE))),
    );

    // Remarks tokens for the day (comma-separated). A bare "MANUAL SI" flag said
    // a manual receipt had been issued but not WHICH one, so the number had to be
    // looked up by hand. Emit one token per manual receipt naming both the manual
    // SI/OR number the cashier wrote and the POS SI it was recorded under.
    // Tokens are kept comma-free (any comma inside a manual reference becomes a
    // space) because the monthly consolidation below splits remarks on commas to
    // union each day's tokens.
    const MAX_MANUAL_SI_TOKENS = 10;
    const manualSITokens = Array.from(
      new Set(
        rows
          .filter((i) => String(i.manualReference || '').trim() !== '')
          .sort((a, b) => (Number(a.receiptNo) || 0) - (Number(b.receiptNo) || 0))
          .map((i) => {
            const refText = String(i.manualReference).trim().replace(/,/g, ' ');
            const posSI = formatReceiptNoWithCycle(i.receiptCycle, i.receiptNo);
            return posSI ? `MANUAL SI ${refText} (POS SI ${posSI})` : `MANUAL SI ${refText}`;
          }),
      ),
    );
    const remarksTokens: string[] = [];
    if (manualSITokens.length > MAX_MANUAL_SI_TOKENS) {
      // Cap the cell: a heavy manual-receipt day would otherwise render a remarks
      // cell hundreds of characters wide. The full per-receipt list stays
      // available in the Manual Transactions report.
      remarksTokens.push(
        ...manualSITokens.slice(0, MAX_MANUAL_SI_TOKENS),
        `+${manualSITokens.length - MAX_MANUAL_SI_TOKENS} more MANUAL SI`,
      );
    } else {
      remarksTokens.push(...manualSITokens);
    }
    const remarks = remarksTokens.join(', ');

    const grandAccumBeginningBalance = prevGrandAccumBeginningBalance;

    const lessDiscount = Number(rd.lessDiscount) || 0;
    const lessReturn = Number(rd.lessReturn) || 0;
    const lessVoid = filterVoidSummaryByDate(voidSummary, key) || Number(rd.lessVoid) || 0;
    const lessRefundAmount = Math.abs(
      Number(rd.refundNetAmount ?? rd.refundSalesAdjustmentAmount ?? rd.refundBaseAmount ?? rd.refundTotal) || 0,
    );
    const rdLessVatAdj = Number(rd.lessVatAdjustment) || 0;
    const refundVatReturns = Number(rd.refundVatReturns) || 0;
    const voidVatAdj = filterVoidVatByDate(voidSummary, key) || 0;
    const vatOnReturnsFromTxns = Number(rd.vatOnReturns) || 0;
    const vatPayableAdjustment = vatOnReturnsFromTxns + refundVatReturns + voidVatAdj;

    const deductions = {
      sc: Number(rd.scDiscount) || 0,
      pwd: Number(rd.pwdDiscount) || 0,
      naac: Number(rd.naacDiscount) || 0,
      soloParent: Number(rd.soloParentDiscount) || 0,
      medalOfValor: Number((rd as any).medalOfValorDiscount) || 0,
      others: Number(rd.othersDiscount) || 0,
      returns: lessReturn,
      voids: lessVoid,
      total: lessDiscount + lessReturn + lessVoid,
    };

    const scVatAdj = Number(rd.scVatAdj) || 0;
    const pwdVatAdj = Number(rd.pwdVatAdj) || 0;
    const soloParentVatAdj = Number(rd.soloParentVatAdj) || 0;
    const medalOfValorVatAdj = Number((rd as any).medalOfValorVatAdj) || 0;
    const regTxnsVatAdj = Number(rd.othersTrans) || 0;
    const zeroRatedVatAdj = Number(rd.zeroRatedVatAdj) || 0;

    // Cap VAT adjustment so net never goes below 0 (matches Z-reading).
    const deductionsWithoutVatAdj = deductions.total + lessRefundAmount;
    const headroom = grossSales - deductionsWithoutVatAdj;
    const lessVatAdjToApply = headroom >= 0 ? Math.min(rdLessVatAdj, headroom) : 0;
    const adjustmentTotal = lessVatAdjToApply;

    const netSales = grossSales - deductionsWithoutVatAdj - lessVatAdjToApply;
    const vatPayable = Math.round((vatAmount - vatPayableAdjustment) * 100) / 100;

    const totalDeductions =
      deductions.sc + deductions.pwd + deductions.naac + deductions.soloParent +
      deductions.medalOfValor + deductions.others + deductions.returns + lessRefundAmount + deductions.voids;

    const totalIncome = netSales;

    const grandAccumEndingBalance = grandAccumBeginningBalance + grossSales;
    prevGrandAccumBeginningBalance = grandAccumEndingBalance;
    index++;

    const yymmdd = Moment(key, 'YYYY-MM-DD').format('YYMMDD');
    const overrun = overrunByDate?.[yymmdd];
    // Reset Counter (BIRresetNo) is a pure function of accumulated sales: it
    // advances once per 12-digit max (₱9,999,999,999.99 -> threshold
    // ₱10,000,000,000) that the monotonic accumulated gross has crossed.
    // Do NOT read the Z-history snapshot here: those snapshots recorded the
    // then-current global BIRresetNo, which for historical/re-downloaded data is
    // uniformly the latest value (e.g. 02 on every row) rather than the value as
    // of that day. Deriving from the accumulated balance matches the Z-reading
    // receipt (same crossing logic) and yields 00/01/02 correctly.
    const resetCounter = String(
      Math.floor((Number(grandAccumEndingBalance) || 0) / ACCUMULATED_SALES_RESET_THRESHOLD),
    ).padStart(2, '0');
    const zCounter = (zCounters && zCounters[yymmdd]) ?? zReadNo ?? 0;

    sheet1.push([
      Moment(key, 'YYYY-MM-DD').format('MM/DD/YYYY'),
      formatReceiptNoWithCycle(beginningReceiptCycle, beginningReceiptNo),
      formatReceiptNoWithCycle(endingReceiptCycle, endingReceiptNo),
      normalizeNumber(grandAccumEndingBalance),
      normalizeNumber(grandAccumBeginningBalance),
      normalizeNumber(manualSalesForDay),
      normalizeNumber(grossSales),
      normalizeNumber(vatableSales),
      normalizeNumber(vatAmount),
      normalizeNumber(vatExemptSales),
      normalizeNumber(zeroRatedSales),
      normalizeNumber(deductions.sc),
      normalizeNumber(deductions.pwd),
      normalizeNumber(deductions.naac),
      normalizeNumber(deductions.soloParent),
      normalizeNumber(deductions.medalOfValor),
      normalizeNumber(deductions.others),
      normalizeNumber(deductions.returns),
      normalizeNumber(lessRefundAmount),
      normalizeNumber(deductions.voids),
      normalizeNumber(totalDeductions),
      normalizeNumber(scVatAdj),
      normalizeNumber(pwdVatAdj),
      normalizeNumber(soloParentVatAdj),
      normalizeNumber(medalOfValorVatAdj),
      normalizeNumber(zeroRatedVatAdj),
      normalizeNumber(regTxnsVatAdj),
      normalizeNumber(vatOnReturnsFromTxns),
      normalizeNumber(voidVatAdj),
      normalizeNumber(refundVatReturns),
      normalizeNumber(0),
      normalizeNumber(adjustmentTotal),
      normalizeNumber(vatPayable),
      normalizeNumber(netSales),
      overrun != null ? normalizeNumber(overrun) : '',
      normalizeNumber(totalIncome),
      resetCounter,
      normalizeNumber(zCounter),
      remarks,
    ]);
  }

  // Monthly consolidation: collapse per-day rows into one summary row.
  if (consolidate && sheet1.length > 0) {
    const firstRow = sheet1[0];
    const lastRow = sheet1[sheet1.length - 1];
    const num = (v: any) => (v === '' || v == null ? 0 : Number(v) || 0);
    const sumCol = (c: number) => sheet1.reduce((s, r) => s + num(r[c]), 0);
    const consolidated: any[] = new Array(firstRow.length).fill('');
    consolidated[0] = Moment(firstRow[0], 'MM/DD/YYYY').format('YYYY-MM');
    consolidated[1] = firstRow[1];
    consolidated[2] = lastRow[2];
    consolidated[3] = lastRow[3];
    consolidated[4] = firstRow[4];
    for (let c = 5; c <= 35; c++) consolidated[c] = normalizeNumber(sumCol(c));
    consolidated[36] = lastRow[36]; // Reset Counter (carry last)
    consolidated[37] = lastRow[37]; // Z-Counter (carry last)
    // Remarks: union of every day's comma-separated tokens (e.g. "MANUAL SI").
    consolidated[38] = Array.from(
      new Set(
        sheet1.flatMap((r) =>
          String(r[38] || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ),
    ).join(', ');
    return { sheet1: [consolidated], sheetBreakdown };
  }

  return { sheet1, sheetBreakdown };
};

/**
 * Detailed Sales Report: one row per transaction. Ported from mobile
 * salesSummary.ts DetailedSalesReport.
 */
export const DetailedSalesReport = (
  txnSnapshot: any,
  adjustments?: { refundSummary?: any; returnSummary?: any; voidSummary?: any },
): { sheetRows: any[][] } => {
  const txnSummary = getTransactionSummary(txnSnapshot);
  const sorted = sortBy(txnSummary, (t: any) => parseInt(String(t.key || 0), 10));

  const adjByKey: Record<string, {
    salesRefund: number; salesVoid: number; salesReturn: number;
    vatRefund: number; vatVoid: number; vatReturn: number;
  }> = {};
  const ensureAdj = (k: string) => {
    const key = String(k || '');
    if (!adjByKey[key]) {
      adjByKey[key] = { salesRefund: 0, salesVoid: 0, salesReturn: 0, vatRefund: 0, vatVoid: 0, vatReturn: 0 };
    }
    return adjByKey[key];
  };
  for (const r of (Array.isArray(adjustments?.refundSummary) ? adjustments!.refundSummary : []) as any[]) {
    const a = ensureAdj(r.transactionKey || r.originalTransactionKey);
    a.salesRefund += Math.abs(Number(r.totalRefundAmount) || 0);
    a.vatRefund += Math.abs(Number(r.vatAmount) || 0);
  }
  for (const r of ((adjustments?.returnSummary?.returns as any[]) || [])) {
    const a = ensureAdj(r.originalTransactionKey || r.transactionKey);
    const base = Math.abs((Number(r.vatableSales) || 0) + (Number(r.vatExemptSales) || 0) + (Number(r.zeroRatedSales) || 0));
    a.salesReturn += base;
    a.vatReturn += Math.abs(Number(r.vatAmount) || 0);
  }
  for (const v of ((adjustments?.voidSummary?.voids as any[]) || [])) {
    if (v.isCancel) continue;
    const a = ensureAdj(v.originalTransactionKey || v.key);
    a.salesVoid += Math.abs(Number(v.voidBase) || 0);
    a.vatVoid += Math.abs(Number(v.voidVat) || 0);
  }

  const header = [
    'Date', 'Time', 'SI No.', 'Sales Issued w/ Manual SI', 'Gross Sales',
    'VATable Sales', 'VAT-Exempt Sales', 'VAT Zero-Rated Sales', 'VAT Amount (VATable Only)',
    'Service Charge', 'SC Discount', 'PWD Discount', 'NAAC Discount', 'Solo Parent Discount',
    'Medal of Valor Discount', 'Regular Discount', 'Total Discount',
    'Sales Adj: Refund', 'Sales Adj: Void', 'Sales Adj: Return',
    'VAT Adj: SC', 'VAT Adj: PWD', 'VAT Adj: Solo Parent', 'VAT Adj: Medal of Valor',
    'Regular Discount VAT Adj', 'VAT Adj: Zero Rated / Diplomat',
    'VAT Adj: Refund', 'VAT Adj: Void', 'VAT Adj: Return', 'Payment Types', 'Net Amount',
  ];
  const sheetRows: any[][] = [header];

  for (const t of sorted as any[]) {
    const key = t.key;
    const ts = key != null ? parseInt(String(key), 10) : 0;
    // Display column: match the SI's MM/DD/YYYY. `t.date` arrives as an
    // ISO-ish grouping key, so parse it rather than printing it raw.
    const dateStr = t.date
      ? Moment(t.date, ['YYYY-MM-DD', 'MM/DD/YYYY']).format('MM/DD/YYYY')
      : ts
        ? Moment.unix(ts).format('MM/DD/YYYY')
        : '';
    const timeStr = ts ? Moment.unix(ts).format('HH:mm') : '';

    const gross =
      t.grossSales ??
      ((t.vatableSales || 0) + (t.vatAmount || 0) + (t.vatExemptSales || 0) + ((t.zeroRatedSales || 0) * (1 + VAT_RATE)));
    const movDisc = (t.deductions?.discount as any)?.medalOfValor || 0;
    const totalDisc =
      (t.deductions?.discount?.sc || 0) + (t.deductions?.discount?.pwd || 0) + (t.deductions?.discount?.naac || 0) +
      (t.deductions?.discount?.soloParent || 0) + movDisc + (t.deductions?.discount?.others || 0);
    const paymentTypes = t.paymentTypeTotals ? Object.keys(t.paymentTypeTotals).join(', ') : '';
    const lineAdj = adjByKey[String(t.key)] || ({} as any);
    const net =
      (t.vatableSales || 0) + (t.vatExemptSales || 0) + (t.zeroRatedSales || 0) -
      (t.deductions?.discount?.sc || 0) - (t.deductions?.discount?.pwd || 0) - (t.deductions?.discount?.naac || 0) -
      (t.deductions?.discount?.soloParent || 0) - movDisc -
      (lineAdj.salesRefund || 0) - (lineAdj.salesVoid || 0) - (lineAdj.salesReturn || 0);
    const manualSales = String(t.manualReference || '').trim() ? gross : 0;

    sheetRows.push([
      dateStr, timeStr, formatReceiptNoWithCycle(t.receiptCycle, t.receiptNo),
      normalizeNumber(manualSales), normalizeNumber(gross),
      normalizeNumber(t.vatableSales || 0), normalizeNumber(t.vatExemptSales || 0),
      normalizeNumber(t.zeroRatedSales || 0), normalizeNumber(t.vatAmount || 0),
      normalizeNumber(t.serviceCharge ?? t.service ?? 0),
      normalizeNumber(t.deductions?.discount?.sc ?? 0), normalizeNumber(t.deductions?.discount?.pwd ?? 0),
      normalizeNumber(t.deductions?.discount?.naac ?? 0), normalizeNumber(t.deductions?.discount?.soloParent ?? 0),
      normalizeNumber((t.deductions?.discount as any)?.medalOfValor ?? 0), normalizeNumber(t.deductions?.discount?.others ?? 0),
      normalizeNumber(totalDisc),
      normalizeNumber(lineAdj.salesRefund ?? 0), normalizeNumber(lineAdj.salesVoid ?? 0), normalizeNumber(lineAdj.salesReturn ?? 0),
      normalizeNumber(t.adjustmentOnVat?.discount?.sc ?? 0), normalizeNumber(t.adjustmentOnVat?.discount?.pwd ?? 0),
      normalizeNumber((t.adjustmentOnVat?.discount as any)?.soloParent ?? 0), normalizeNumber((t.adjustmentOnVat?.discount as any)?.medalOfValor ?? 0),
      normalizeNumber(t.adjustmentOnVat?.discount?.others ?? 0), normalizeNumber((t.zeroRatedSales || 0) * VAT_RATE),
      normalizeNumber(lineAdj.vatRefund ?? 0), normalizeNumber(lineAdj.vatVoid ?? 0), normalizeNumber(lineAdj.vatReturn ?? 0),
      paymentTypes, normalizeNumber(net),
    ]);
  }

  // Totals row last. Identifier and running columns are excluded by header.
  return { sheetRows: appendTotalsRow(sheetRows) };
};

export const SALES_SUMMARY_COLUMNS = [
  'Date',
  'Beginning SI No.',
  'Ending SI No.',
  'Grand Accum. Sales Ending Balance',
  'Grand Accum. Beg. Balance',
  'Sales Issued w/ Manual SI (per RR 16-2018)',
  'Gross Sales for the Day',
  'VATable Sales',
  'VAT Amount',
  'VAT-Exempt Sales',
  'Zero-Rated Sales',
  'Deductions - Discount - SC',
  'Deductions - Discount - PWD',
  'Deductions - Discount - NAAC',
  'Deductions - Discount - Solo Parent',
  'Deductions - Discount - Medal of Valor',
  'Deductions - Discount - Others',
  'Deductions - Returns',
  'Deductions - Refunds',
  'Deductions - Voids',
  'Total Deductions',
  'Adjustment on VAT - Discount - SC',
  'Adjustment on VAT - Discount - PWD',
  'Adjustment on VAT - Discount - Solo Parent',
  'Adjustment on VAT - Discount - Medal of Valor',
  'Adjustment on VAT - Discount - Diplomat',
  'Adjustment on VAT - Discount - Others',
  'Adjustment on VAT - VAT on Returns',
  'Adjustment on VAT - VAT on Void',
  'Adjustment on VAT - VAT on Refund',
  'Adjustment on VAT - Others',
  'Total VAT Adjustment',
  'VAT Payable',
  'Net Sales',
  'Sales Overrun/Overflow',
  'Total Income',
  'Reset Counter',
  'Z-Counter',
  'Remarks',
];

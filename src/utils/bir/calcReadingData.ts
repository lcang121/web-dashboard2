import { sumBy } from 'lodash-es';

const VAT_RATE = 0.12;

const normalizeNumber = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) {
    return rounded.toString().replace(/[,;:\t]/g, '');
  }
  return rounded.toFixed(2).replace(/[,;:\t]/g, '');
};

const first = <T,>(arr: T[]): T | undefined => arr.length > 0 ? arr[0] : undefined;
const last = <T,>(arr: T[]): T | undefined => arr.length > 0 ? arr[arr.length - 1] : undefined;

interface TxnSummary {
  key?: string;
  transactionKey?: string;
  date: string;
  receiptNo: number;
  receiptCycle?: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  grossSales?: number;
  service: number;
  serviceCharge?: number;
  deductions: {
    discount: {
      sc: number;
      pwd: number;
      naac: number;
      soloParent: number;
      others: number;
    };
    returns: number;
    voids: number;
  };
  adjustmentOnVat: {
    discount: {
      sc: number;
      pwd: number;
      naac?: number;
      soloParent?: number;
      others: number;
    };
    returns: number;
    others: number;
  };
  paymentTypeTotals?: Record<string, number> | Record<string, number>[];
}

interface RefundSummaryItem {
  transactionKey?: string;
  originalTransactionKey?: string;
  date: string;
  receiptNo: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  totalRefundAmount?: number;
  refundNetAmount?: number;
  netAmount?: number;
  amountDue?: number;
  scRefundDiscount?: number;
  scReturnDiscount?: number;
  pwdRefundDiscount?: number;
  pwdReturnDiscount?: number;
  naacRefundDiscount?: number;
  soloParentRefundDiscount?: number;
  othersRefundDiscount?: number;
}

interface RefundSummary extends Array<RefundSummaryItem> {
  refundsByPaymentType?: Record<string, number>;
}

interface ReturnSummaryItem {
  transactionKey?: string;
  originalTransactionKey?: string;
  returnNo?: number;
  returnAmount: number;
  paymentType: string;
  zeroRatedReturnVatAdj?: number;
}

interface VoidSummaryItem {
  transactionKey?: string;
  originalTransactionKey?: string;
  amount?: number;
  voidBase?: number;
  paymentType?: string;
}

interface VoidSummary {
  voids?: VoidSummaryItem[];
  totalVoidVat?: number;
  totalVoidBase?: number;
  totalVoids?: number;
}

interface ReturnSummary extends Array<ReturnSummaryItem> {
  returns?: ReturnSummaryItem[];
  totalReturnAmount?: number;
  returnBaseAmount?: number;
  returnNetAmount?: number;
  zeroRatedReturnVatAdj?: number;
}

interface CalcReadingDataResult {
  beginningCI: string | number;
  endingCI: string | number;
  beginningCICycle: number;
  endingCICycle: number;
  beginningVoid: string | number;
  endingVoid: string | number;
  beginningReturn: string | number;
  endingReturn: string | number;
  vatableSales: string | number;
  vatAmount: string | number;
  vatExemptSales: string | number;
  zeroRatedSales: string | number;
  grossSales: string | number;
  grossSalesBeforeDiscount: string | number;
  lessDiscount: string | number;
  lessReturn: string | number;
  lessVoid: string | number;
  lessVatAdjustment: string | number;
  netAmount: string | number;
  scDiscount: string | number;
  pwdDiscount: string | number;
  naacDiscount: string | number;
  soloParentDiscount: string | number;
  othersDiscount: string | number;
  othersTrans: string | number;
  vatOnReturns: string | number;
  scVatAdj: string | number;
  pwdVatAdj: string | number;
  soloParentVatAdj: string | number;
  zeroRatedVatAdj: string | number;
  refundTotal: string | number;
  refundNetAmount: string | number;
  refundBaseAmount: string | number;
  refundSalesAdjustmentAmount: string | number;
  refundGrandTotal: string | number;
  refundVatReturns: string | number;
  service: string | number;
  nonCashPayments: Record<string, string | number>;
  totalReturnAmount: string | number;
  serviceCharge: string | number;
  vatPayable?: string | number;
}

export const calcReadingData = (
  txnSummary: TxnSummary[],
  refundSummary: RefundSummary | RefundSummaryItem[],
  returnSummary?: ReturnSummary | ReturnSummaryItem[] | any,
  voidSummary?: VoidSummary,
  lastReceiptInfo?: { receiptNo: number; receiptCycle: number } | null,
): CalcReadingDataResult => {
  const safeTxnSummary = Array.isArray(txnSummary) ? txnSummary : [];
  const safeRefundSummary = Array.isArray(refundSummary) ? refundSummary : [];
  const safeReturnSummary: ReturnSummaryItem[] = Array.isArray(returnSummary)
    ? (returnSummary as ReturnSummaryItem[])
    : ((returnSummary?.returns || []) as ReturnSummaryItem[]);
  const totalReturnAmount = returnSummary?.totalReturnAmount || 0;

  // Separate transactions into original and returned
  const originalTxns: TxnSummary[] = [];
  const returnedTxns: TxnSummary[] = [];

  safeTxnSummary.forEach((txn) => {
    if (
      txn.vatableSales < 0 ||
      txn.vatAmount < 0 ||
      txn.vatExemptSales < 0 ||
      txn.zeroRatedSales < 0
    ) {
      returnedTxns.push(txn);
    } else {
      originalTxns.push(txn);
    }
  });

  const beginningCI =
    safeTxnSummary.length > 0 ? first(safeTxnSummary)?.receiptNo ?? 0 : lastReceiptInfo?.receiptNo ?? 0;
  const endingCI =
    safeTxnSummary.length > 0 ? last(safeTxnSummary)?.receiptNo ?? 0 : lastReceiptInfo?.receiptNo ?? 0;
  const beginningCICycle =
    safeTxnSummary.length > 0 ? first(safeTxnSummary)?.receiptCycle ?? 0 : lastReceiptInfo?.receiptCycle ?? 0;
  const endingCICycle =
    safeTxnSummary.length > 0 ? last(safeTxnSummary)?.receiptCycle ?? 0 : lastReceiptInfo?.receiptCycle ?? 0;
  const beginningVoid = first(safeRefundSummary)?.receiptNo ?? 0;
  const endingVoid = last(safeRefundSummary)?.receiptNo ?? 0;

  const sumPrecise = (arr: any[], key: string | ((i: any) => number)): number => {
    const scale = 1000000;
    const scaled = arr.reduce((acc, i) => {
      const v = typeof key === 'function' ? key(i) : i[key];
      return acc + Math.round((Number(v) || 0) * scale);
    }, 0);
    return scaled / scale;
  };

  const vatableSales = sumPrecise(originalTxns, 'vatableSales');
  const vatExemptSales = sumPrecise(originalTxns, 'vatExemptSales');
  const zeroRatedSales = sumPrecise(originalTxns, 'zeroRatedSales');
  const serviceCharge = sumPrecise(originalTxns, 'serviceCharge');
  const vatAmount = sumPrecise(originalTxns, 'vatAmount');
  const zeroRatedInclusive = Number(zeroRatedSales) * (1 + VAT_RATE);
  const grossSalesBeforeDiscount = sumPrecise(
    originalTxns,
    (i) =>
      (i as any).grossSales ??
      (i.vatableSales +
        i.vatAmount +
        i.vatExemptSales +
        (i.zeroRatedSales && i.zeroRatedSales > 0
          ? i.zeroRatedSales * (1 + VAT_RATE)
          : i.zeroRatedSales || 0)),
  );
  const grossSales = vatableSales + vatAmount + vatExemptSales + zeroRatedInclusive;

  const lessDiscount = sumPrecise(
    originalTxns,
    (i) =>
      i.deductions.discount.sc +
      i.deductions.discount.pwd +
      i.deductions.discount.naac +
      i.deductions.discount.soloParent +
      i.deductions.discount.others,
  );
  const scDiscount = sumPrecise(originalTxns, (i) => i.deductions.discount.sc || 0);
  const pwdDiscount = sumPrecise(originalTxns, (i) => i.deductions.discount.pwd || 0);

  const returnBaseAmount = returnSummary?.returnBaseAmount || 0;
  const lessReturn = Math.abs(returnBaseAmount);

  const lessVoidFromTxn = sumPrecise(safeTxnSummary, (i) => i.deductions.voids || 0);
  const lessVoid = Math.abs(Number(voidSummary?.totalVoidBase ?? voidSummary?.totalVoids ?? lessVoidFromTxn) || 0);
  const naacDiscount = sumPrecise(originalTxns, (i) => i.deductions.discount.naac || 0);
  const soloParentDiscount = sumPrecise(originalTxns, (i) => i.deductions.discount.soloParent || 0);
  const othersDiscount = sumPrecise(originalTxns, (i) => i.deductions.discount.others || 0);
  const othersTrans = sumPrecise(safeTxnSummary, (i) => i.adjustmentOnVat.discount.others || 0);
  const vatOnReturns = sumPrecise(safeTxnSummary, (i) => i.adjustmentOnVat.returns || 0);
  const scVatAdj = sumPrecise(safeTxnSummary, (i) => i.adjustmentOnVat.discount.sc || 0);
  const pwdVatAdj = sumPrecise(safeTxnSummary, (i) => i.adjustmentOnVat.discount.pwd || 0);
  const soloParentVatAdj = sumPrecise(
    safeTxnSummary,
    (i: TxnSummary) => Number((i.adjustmentOnVat.discount as any).soloParent) || 0,
  );

  const zeroRatedReturnVatAdj = Number(returnSummary?.zeroRatedReturnVatAdj) || 0;
  const voidVatAdj = Number(voidSummary?.totalVoidVat ?? 0) || 0;
  const refundVatReturns =
    (safeRefundSummary as RefundSummaryItem[]).reduce?.((s: number, r: any) => s + (r.vatAmount || 0), 0) || 0;
  const zeroRatedVatAdj = Number(zeroRatedSales) * VAT_RATE;
  const lessVatAdjustment =
    scVatAdj +
    pwdVatAdj +
    soloParentVatAdj +
    othersTrans +
    zeroRatedReturnVatAdj +
    zeroRatedVatAdj +
    voidVatAdj +
    refundVatReturns +
    vatOnReturns;

  const refundTotal = sumBy(safeRefundSummary as RefundSummaryItem[], (i) => i.vatableSales + i.vatExemptSales + i.zeroRatedSales) || 0;
  const refundNetAmount = sumBy(
    safeRefundSummary as RefundSummaryItem[],
    (i: any) => {
      const explicitNet = Number(i?.refundNetAmount ?? i?.netAmount ?? i?.amountDue);
      if (!Number.isNaN(explicitNet) && explicitNet !== 0) {
        return Math.abs(explicitNet);
      }

      const base =
        Math.abs((Number(i?.vatableSales) || 0) +
          (Number(i?.vatExemptSales) || 0) +
          (Number(i?.zeroRatedSales) || 0));
      const discount =
        Math.abs(Number(i?.scRefundDiscount ?? i?.scReturnDiscount ?? 0)) +
        Math.abs(Number(i?.pwdRefundDiscount ?? i?.pwdReturnDiscount ?? 0)) +
        Math.abs(Number(i?.naacRefundDiscount ?? 0)) +
        Math.abs(Number(i?.soloParentRefundDiscount ?? 0)) +
        Math.abs(Number(i?.othersRefundDiscount ?? 0));
      return Math.max(0, base - discount);
    },
  ) || 0;

  const refundSalesAdjustmentAmount =
    sumBy(safeRefundSummary as RefundSummaryItem[], (i) => i.vatableSales + i.vatExemptSales + i.zeroRatedSales) || 0;
  const refundBaseAmount = sumBy(
    safeRefundSummary as RefundSummaryItem[],
    (i) => i.vatableSales + i.vatExemptSales + i.zeroRatedSales,
  ) || 0;
  const refundGrandTotal = refundTotal;
  const lessRefundAmount = Math.abs(refundNetAmount || refundSalesAdjustmentAmount || refundBaseAmount || refundTotal);

  const deductionsWithoutVatAdj =
    Math.abs(Number(lessDiscount)) +
    Math.abs(Number(lessVoid)) +
    Math.abs(Number(lessReturn)) +
    lessRefundAmount;

  const grossBase = Number(grossSalesBeforeDiscount) || Number(grossSales);
  const headroom = grossBase - deductionsWithoutVatAdj;
  const lessVatAdjToApply = headroom >= 0 ? Math.min(Number(lessVatAdjustment) || 0, headroom) : 0;

  const normalizeTxnKey = (k: any): string => {
    if (k == null) return '';
    const n = Number(k);
    if (!Number.isNaN(n) && Number.isFinite(n)) return String(Math.trunc(n));
    return String(k).trim();
  };

  const originalTxnKeys = new Set(
    originalTxns
      .map((i: any) => normalizeTxnKey(i.key ?? i.transactionKey))
      .filter(Boolean),
  );
  const reversedTxnKeys = new Set<string>();

  for (const r of returnSummary?.returns || []) {
    const k = normalizeTxnKey((r as any)?.originalTransactionKey ?? (r as any)?.transactionKey);
    if (k) reversedTxnKeys.add(k);
  }
  for (const v of voidSummary?.voids || []) {
    const k = normalizeTxnKey((v as any)?.originalTransactionKey ?? (v as any)?.transactionKey);
    if (k) reversedTxnKeys.add(k);
  }
  for (const rf of safeRefundSummary || []) {
    const k = normalizeTxnKey((rf as any)?.originalTransactionKey ?? (rf as any)?.transactionKey);
    if (k) reversedTxnKeys.add(k);
  }

  const allOriginalsReversed =
    originalTxnKeys.size > 0 && [...originalTxnKeys].every((k) => reversedTxnKeys.has(k));

  const netSales = allOriginalsReversed ? 0 : Math.max(0, grossBase - deductionsWithoutVatAdj - lessVatAdjToApply);
  const service = sumBy(originalTxns, 'service') || 0;

  const nonCashPayments = originalTxns
    .flatMap((i: TxnSummary) => {
      const totals = i.paymentTypeTotals;
      if (!totals) return [];
      return Array.isArray(totals) ? totals : [totals];
    })
    .reduce((acc: any, payment: any) => {
      for (const [key, value] of Object.entries(payment)) {
        if (key === 'Cash') continue;
        acc[key] = (acc[key] || 0) + value;
      }
      return acc;
    }, {});

  for (const key in nonCashPayments) {
    nonCashPayments[key] = normalizeNumber(nonCashPayments[key] as number);
  }

  const normalizePaymentKey = (key: string): string => {
    const k = String(key || '').trim();
    if (!k) return '';
    const lower = k.toLowerCase();
    if (lower === 'cheque') return 'Check';
    return k;
  };

  const nonCashReversalsByType: Record<string, number> = {};

  const addReversalByType = (paymentType: string, amount: number) => {
    const key = normalizePaymentKey(paymentType);
    if (!key || key === 'Cash') return;
    nonCashReversalsByType[key] = (nonCashReversalsByType[key] || 0) + Math.abs(Number(amount) || 0);
  };

  const refundsByPaymentType: Record<string, number> = (refundSummary as any)?.refundsByPaymentType || {};
  for (const [key, amount] of Object.entries(refundsByPaymentType)) {
    addReversalByType(key, Number(amount) || 0);
  }

  for (const r of returnSummary?.returns || []) {
    const returnAmount = Number((r as any)?.returnAmount) || 0;
    addReversalByType((r as any)?.paymentType, returnAmount);
  }

  for (const v of voidSummary?.voids || []) {
    const voidAmount = Number((v as any)?.amount ?? (v as any)?.voidBase ?? 0) || 0;
    addReversalByType((v as any)?.paymentType, voidAmount);
  }

  for (const key in nonCashPayments) {
    const normalizedKey = normalizePaymentKey(key);
    const value = Number(nonCashPayments[key]) || 0;
    const reversal = Number(nonCashReversalsByType[normalizedKey]) || 0;
    nonCashPayments[key] = normalizeNumber(Math.max(0, value - reversal));
  }

  const beginningReturn = first(safeReturnSummary)?.returnNo ?? 0;
  const endingReturn = last(safeReturnSummary)?.returnNo ?? 0;

  // VAT Payable = vatAmount - (vatOnReturns + refundVatReturns + voidVatAdj)
  // Note: NOT subtracting discount VAT adjustments
  const vatPayable = vatAmount - (vatOnReturns + refundVatReturns + voidVatAdj);

  return {
    beginningCI: normalizeNumber(Number(beginningCI)),
    endingCI: normalizeNumber(Number(endingCI)),
    beginningCICycle: Number(beginningCICycle),
    endingCICycle: Number(endingCICycle),
    beginningVoid: normalizeNumber(Number(beginningVoid)),
    endingVoid: normalizeNumber(Number(endingVoid)),
    beginningReturn: normalizeNumber(Number(beginningReturn)),
    endingReturn: normalizeNumber(Number(endingReturn)),
    vatableSales: normalizeNumber(vatableSales),
    vatAmount: normalizeNumber(vatAmount),
    vatExemptSales: normalizeNumber(vatExemptSales),
    zeroRatedSales: normalizeNumber(zeroRatedSales),
    grossSales: normalizeNumber(grossSales),
    grossSalesBeforeDiscount: normalizeNumber(grossSalesBeforeDiscount),
    lessDiscount: normalizeNumber(lessDiscount),
    lessReturn: normalizeNumber(lessReturn),
    lessVoid: normalizeNumber(lessVoid),
    lessVatAdjustment: normalizeNumber(lessVatAdjustment),
    netAmount: normalizeNumber(netSales),
    scDiscount: normalizeNumber(scDiscount),
    pwdDiscount: normalizeNumber(pwdDiscount),
    naacDiscount: normalizeNumber(naacDiscount),
    soloParentDiscount: normalizeNumber(soloParentDiscount),
    othersDiscount: normalizeNumber(othersDiscount),
    othersTrans: normalizeNumber(othersTrans),
    vatOnReturns: normalizeNumber(vatOnReturns),
    scVatAdj: normalizeNumber(scVatAdj),
    pwdVatAdj: normalizeNumber(pwdVatAdj),
    soloParentVatAdj: normalizeNumber(soloParentVatAdj),
    zeroRatedVatAdj: normalizeNumber(zeroRatedVatAdj),
    refundTotal: normalizeNumber(refundTotal),
    refundNetAmount: normalizeNumber(refundNetAmount),
    refundBaseAmount: normalizeNumber(refundBaseAmount),
    refundSalesAdjustmentAmount: normalizeNumber(refundSalesAdjustmentAmount),
    refundGrandTotal: normalizeNumber(refundGrandTotal),
    refundVatReturns: normalizeNumber(refundVatReturns),
    service: normalizeNumber(service),
    nonCashPayments,
    totalReturnAmount: normalizeNumber(Math.abs(totalReturnAmount)),
    serviceCharge: normalizeNumber(serviceCharge),
    vatPayable: normalizeNumber(vatPayable),
  };
};

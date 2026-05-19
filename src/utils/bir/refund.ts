import Moment from 'moment-timezone';

const VAT_RATE = 0.12;
const SENIOR_RATE = 0.2;
const PWD_RATE = 0.2;
const NAAC_RATE = 0.2;
const SOLO_PARENT_RATE = 0.1;
const COMMODITY_RATE = 0.05;

const normalizeDiscountType = (type: string | null | undefined): string => {
  const t = String(type || '').trim().toLowerCase();
  if (!t) return '';
  if (['sc', 'senior', 'seniorcitizen', 'senior_citizen'].includes(t)) return 'senior';
  if (['pwd', 'personwithdisability', 'person_with_disability'].includes(t)) return 'pwd';
  if (['sp', 'soloparent', 'solo_parent'].includes(t)) return 'soloParent';
  if (['ntl', 'ntlathlete', 'naac', 'nationalathlete'].includes(t)) return 'ntlAthlete';
  if (['diplomat'].includes(t)) return 'diplomat';
  if (['commodity'].includes(t)) return 'commodity';
  if (['regular'].includes(t)) return 'regular';
  return String(type || '');
};

const resolveDiscountType = (item: any): string => {
  const explicit = normalizeDiscountType(item.individualDiscountType || item.transactionDiscountType || '');
  if (explicit) return explicit;

  const pax = item?.paxDiscount;
  if (!pax || typeof pax !== 'object') return '';

  if (pax.senior) return 'senior';
  if (pax.pwd) return 'pwd';
  if (pax.sp) return 'soloParent';
  if (pax.ntl) return 'ntlAthlete';
  if (pax.diplomat) return 'diplomat';
  if (pax.regular) return 'regular';
  return '';
};

const resolveDiscountRate = (item: any, discountType: string): number => {
  const pax = item?.paxDiscount;
  if (pax && typeof pax === 'object') {
    if (discountType === 'senior' && pax.senior) return (parseFloat(pax.senior.percent) || 20) / 100;
    if (discountType === 'pwd' && pax.pwd) return (parseFloat(pax.pwd.percent) || 20) / 100;
    if (discountType === 'soloParent' && pax.sp) return (parseFloat(pax.sp.percent) || 10) / 100;
    if (discountType === 'regular' && pax.regular) return (parseFloat(pax.regular.percent) || 0) / 100;
  }

  if (discountType === 'senior') return SENIOR_RATE;
  if (discountType === 'pwd') return PWD_RATE;
  if (discountType === 'soloParent') return SOLO_PARENT_RATE;
  return 0;
};

const roundMoney = (value: number): number => {
  const numValue = parseFloat(String(value)) || 0;
  const rounded = Math.round(Math.abs(numValue));
  return numValue < 0 ? -1 * rounded : rounded;
};

interface RefundSummaryItem {
  refundKey: string;
  transactionKey: string;
  date: string;
  refundNo: number | null;
  receiptNo: string | number;
  receiptCycle: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  refundGrandTotal: number;
  totalRefundAmount: number;
}

interface RefundSummaryResult extends Array<any> {
  beginningRefundSI?: string;
  endingRefundSI?: string;
  refundsByPaymentType?: { [key: string]: number };
}

export const getRefundSummary = (snapshot: any): RefundSummaryResult => {
  const data: RefundSummaryItem[] = [];
  const refundsByPaymentType: { [key: string]: number } = {};

  if (!snapshot || !snapshot.forEach) {
    const result: RefundSummaryResult = data as any;
    result.beginningRefundSI = '';
    result.endingRefundSI = '';
    result.refundsByPaymentType = refundsByPaymentType;
    return result;
  }

  snapshot.forEach((snap: any) => {
    const key = snap.key;
    const value = snap.val();

    if (value.trainingMode) return;

    const paymentType = value.paymentType || 'Cash';
    const refundTotal = Math.abs(parseFloat(value.total) || 0);
    if (refundTotal > 0) {
      refundsByPaymentType[paymentType] = (refundsByPaymentType[paymentType] || 0) + refundTotal;
    }

    const matchKey = value.originalRefundKey != null ? String(value.originalRefundKey) : String(key);
    const isRefundedItem = (item: any) => item != null && item.refund != null && String(item.refund) === matchKey;
    const refundedItems = (value.items || []).filter(isRefundedItem);

    let vatableSales = 0;
    let vatAmount = 0;
    let vatExemptSales = 0;
    let zeroRatedSales = 0;
    let refundGrandTotal = 0;
    let salesAdjVatAmount = 0;

    for (const item of refundedItems) {
      const vatType = item._defaultVatType ? item._defaultVatType : item.zeroVAT ? 'vatExempt' : 'vatable';
      const totalPrice = (item.price || 0) * Math.abs(item.quantity || 1);

      refundGrandTotal += totalPrice;

      // PAX discount
      if (item.paxDiscount && typeof item.paxDiscount === 'object') {
        const guestCount = Object.values(item.paxDiscount as any).reduce(
          (a: number, e: any) => a + (parseInt(e?.guestCount, 10) || 0),
          0
        );
        if (guestCount > 0) {
          const isCommodity = item.isCommodity === true;
          const baseAmount = totalPrice / (1 + VAT_RATE);

          for (const [paxDiscType, discObj] of Object.entries(item.paxDiscount as any)) {
            const seatCount = parseInt((discObj as any)?.guestCount, 10) || 0;
            if (seatCount <= 0) continue;
            const guestRatio = seatCount / guestCount;
            const proportionalBase = baseAmount * guestRatio;
            const proportionalGross = totalPrice * guestRatio;
            const normalizedType = normalizeDiscountType(paxDiscType);

            const discRate =
              (parseFloat((discObj as any)?.percent) || 0) / 100 ||
              (normalizedType === 'senior' || normalizedType === 'pwd'
                ? SENIOR_RATE
                : normalizedType === 'soloParent'
                  ? SOLO_PARENT_RATE
                  : normalizedType === 'ntlAthlete'
                    ? NAAC_RATE
                    : 0);

            if (normalizedType === 'ntlAthlete') {
              vatableSales += proportionalBase * (1 - NAAC_RATE);
              vatAmount += proportionalBase * VAT_RATE;
            } else if (['senior', 'pwd', 'soloParent', 'commodity'].includes(normalizedType)) {
              if (isCommodity && (normalizedType === 'senior' || normalizedType === 'pwd')) {
                const commodityRate = COMMODITY_RATE;
                vatableSales += proportionalBase * (1 - commodityRate);
                const partVat = proportionalBase * (1 - commodityRate) * VAT_RATE;
                vatAmount += partVat;
                salesAdjVatAmount += partVat;
              } else {
                vatExemptSales += proportionalBase * (1 - discRate);
              }
            } else if (normalizedType === 'diplomat') {
              zeroRatedSales += proportionalBase;
            } else if (normalizedType === 'regular') {
              const discounted = proportionalGross * (1 - discRate);
              vatableSales += discounted / (1 + VAT_RATE);
              const itemVat = discounted - discounted / (1 + VAT_RATE);
              vatAmount += itemVat;
              salesAdjVatAmount += itemVat;
            }
          }
          continue;
        }
      }

      const discountType = resolveDiscountType(item);
      if (discountType === 'ntlAthlete') {
        const naacBase = totalPrice / (1 + VAT_RATE);
        const naacDiscountedBase = naacBase * (1 - NAAC_RATE);
        vatableSales += naacDiscountedBase;
        vatAmount += naacBase * VAT_RATE;
      } else if (['senior', 'pwd', 'soloParent', 'commodity'].includes(discountType)) {
        const discountRate = resolveDiscountRate(item, discountType);
        vatExemptSales += (totalPrice / (1 + VAT_RATE)) * (1 - discountRate);
      } else if (discountType === 'diplomat') {
        const diplomataBase = totalPrice / (1 + VAT_RATE);
        zeroRatedSales += diplomataBase;
      } else if (discountType === 'regular' && (vatType === 'vatable' || !vatType)) {
        const paxRate = resolveDiscountRate(item, discountType);
        const rawDiscount = item.discount || item.discountSubtotal || 0;
        const effectiveRate = paxRate > 0 ? paxRate : rawDiscount / 100;
        const discountedPrice = totalPrice * (1 - effectiveRate);
        vatableSales += discountedPrice / (1 + VAT_RATE);
        const itemVat = discountedPrice - discountedPrice / (1 + VAT_RATE);
        vatAmount += itemVat;
        salesAdjVatAmount += itemVat;
      } else if (vatType === 'vatable') {
        vatableSales += totalPrice / (1 + VAT_RATE);
        const itemVat = totalPrice - totalPrice / (1 + VAT_RATE);
        vatAmount += itemVat;
        salesAdjVatAmount += itemVat;
      } else if (vatType === 'vatExempt') {
        vatExemptSales += totalPrice;
      } else if (vatType === 'zeroVat') {
        zeroRatedSales += totalPrice / (1 + VAT_RATE);
      }
    }

    const date = Moment.unix(parseInt(key)).format('YYYY-MM-DD');
    const receiptNo = value.receiptNo;
    const receiptCycle = value.receiptCycle ?? 0;
    const totalRefundAmount = vatableSales + vatExemptSales + zeroRatedSales;

    data.push({
      refundKey: key,
      transactionKey: value.transactionKey || value.originalTransactionKey || '',
      date,
      refundNo: value.refundNo || null,
      receiptNo,
      receiptCycle,
      vatableSales,
      vatAmount,
      vatExemptSales,
      zeroRatedSales,
      refundGrandTotal,
      totalRefundAmount,
    });
  });

  const withRefundNo = data
    .map((r) => ({ ...r, effectiveRefundNo: r.refundNo ?? parseInt(String(r.receiptNo)) }))
    .filter((r) => r.effectiveRefundNo != null);
  const sortedByRefundNo = [...withRefundNo].sort(
    (a, b) => (parseInt(a.effectiveRefundNo, 10) || 0) - (parseInt(b.effectiveRefundNo, 10) || 0)
  );
  const beginningRefundSI = sortedByRefundNo.length
    ? `00-${String(parseInt(sortedByRefundNo[0].effectiveRefundNo) || 0).padStart(6, '0')}`
    : '';
  const endingRefundSI = sortedByRefundNo.length
    ? `00-${String(parseInt(sortedByRefundNo[sortedByRefundNo.length - 1].effectiveRefundNo) || 0).padStart(6, '0')}`
    : '';

  const result: RefundSummaryResult = data as any;
  result.beginningRefundSI = beginningRefundSI;
  result.endingRefundSI = endingRefundSI;
  result.refundsByPaymentType = refundsByPaymentType;
  return result;
};

interface ReturnSummaryItem {
  key: string;
  originalTransactionKey: string;
  returnNo: number;
  returnAmount: number;
  receiptNo: string | number;
  receiptCycle: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  scReturnDiscount: number;
  pwdReturnDiscount: number;
  regDiscReturnVat: number;
  zeroRatedReturnBase: number;
  paymentType: string;
}

interface ReturnSummaryResult {
  returns: ReturnSummaryItem[];
  totalReturnAmount: number;
  returnBaseAmount: number;
  cashReturnAmount: number;
  cashReturnNetAmount: number;
  totalReturnVatExemptSales: number;
  count: number;
  totalScReturnDiscount: number;
  totalPwdReturnDiscount: number;
  scReturnVatAdj: number;
  pwdReturnVatAdj: number;
  regDiscReturnVatAdj: number;
  zeroRatedReturnVatAdj: number;
  vatOnReturns: number;
  beginningReturnSI: string;
  endingReturnSI: string;
}

export const getReturnSummary = (snapshot: any): ReturnSummaryResult => {
  const data: ReturnSummaryItem[] = [];
  let totalReturnAmount = 0;

  snapshot.forEach((snap: any) => {
    const key = snap.key;
    const value = snap.val();

    if (value.trainingMode) return;

    let returnNo = 0;
    if (value.returns && typeof value.returns === 'object') {
      const returnNos = Object.values(value.returns as any);
      returnNo = returnNos.length > 0 ? Math.max(...(returnNos as number[])) : 0;
    }

    let vatableSales = 0;
    let vatAmount = 0;
    let vatExemptSales = 0;
    let zeroRatedSales = 0;
    let returnAmount = 0;
    let scReturnDiscount = 0;
    let pwdReturnDiscount = 0;
    let regDiscReturnVat = 0;
    let zeroRatedReturnBase = 0;

    for (const item of value.items || []) {
      if (!item || !item.returned) continue;

      const vatType = item._defaultVatType;
      const discountType = resolveDiscountType(item);
      const itemDiscount = item.discount || 0;
      const txnDiscountPct = item.discountSubtotal || 0;
      const discount = itemDiscount || txnDiscountPct;
      const totalPrice = (item.price || 0) * Math.abs(item.quantity || 0);
      const baseAmount = totalPrice / (1 + VAT_RATE);
      const discountRate = resolveDiscountRate(item, discountType);
      returnAmount += totalPrice;

      const signedTotalPrice = (item.price || 0) * (item.quantity || 0);
      const signedBase = signedTotalPrice / (1 + VAT_RATE);

      if (vatType === 'vatable' && !['senior', 'pwd', 'soloParent', 'diplomat'].includes(discountType)) {
        if (discountType === 'ntlAthlete') {
          vatableSales += signedBase * (1 - NAAC_RATE);
          vatAmount += signedBase * VAT_RATE;
        } else if (discountType === 'regular') {
          const effectiveRate = discountRate > 0 ? discountRate : discount / 100;
          const discountedBase = signedBase * (1 - effectiveRate);
          vatableSales += discountedBase;
          vatAmount += discountedBase * VAT_RATE;
          if (effectiveRate > 0) {
            regDiscReturnVat += Math.abs(discountedBase) * VAT_RATE;
          }
        } else {
          vatableSales += signedBase;
          vatAmount += signedBase * VAT_RATE;
        }
      }

      if (vatType === 'vatExempt' || ['senior', 'pwd', 'soloParent'].includes(discountType)) {
        const exemptAmount =
          vatType === 'vatExempt'
            ? signedTotalPrice
            : discountType === 'soloParent'
              ? signedBase * (1 - SOLO_PARENT_RATE)
              : signedBase * (1 - discountRate);
        vatExemptSales += exemptAmount;
        if (discountType === 'senior') {
          scReturnDiscount += Math.abs(baseAmount) * discountRate;
        } else if (discountType === 'pwd') {
          pwdReturnDiscount += Math.abs(baseAmount) * discountRate;
        }
      }

      if (discountType === 'diplomat' || (vatType === 'zeroVAT' && !['senior', 'pwd', 'soloParent'].includes(discountType))) {
        const zrBase = signedTotalPrice / (1 + VAT_RATE);
        zeroRatedSales += zrBase;
      }
    }

    totalReturnAmount += returnAmount;
    const paymentType = value.paymentType || 'Cash';
    const receiptNo = value.receiptNo;
    const receiptCycle = value.receiptCycle ?? 0;

    data.push({
      key,
      originalTransactionKey: value.originalTransactionKey || value.transactionKey || '',
      returnNo,
      returnAmount,
      receiptNo,
      receiptCycle,
      vatableSales,
      vatAmount,
      vatExemptSales,
      zeroRatedSales,
      scReturnDiscount,
      pwdReturnDiscount,
      regDiscReturnVat,
      zeroRatedReturnBase,
      paymentType,
    });
  });

  const withReturnNo = data
    .map((r) => ({ ...r, effectiveReturnNo: r.returnNo ?? parseInt(String(r.receiptNo)) }))
    .filter((r) => r.effectiveReturnNo != null);
  const sortedByReturnNo = [...withReturnNo].sort(
    (a, b) => (parseInt(a.effectiveReturnNo, 10) || 0) - (parseInt(b.effectiveReturnNo, 10) || 0)
  );
  const beginningReturnSI = sortedByReturnNo.length
    ? `00-${String(parseInt(sortedByReturnNo[0].effectiveReturnNo) || 0).padStart(6, '0')}`
    : '';
  const endingReturnSI = sortedByReturnNo.length
    ? `00-${String(parseInt(sortedByReturnNo[sortedByReturnNo.length - 1].effectiveReturnNo) || 0).padStart(6, '0')}`
    : '';

  const totalScReturnDiscount = data.reduce((s, r) => s + (r.scReturnDiscount || 0), 0);
  const totalPwdReturnDiscount = data.reduce((s, r) => s + (r.pwdReturnDiscount || 0), 0);
  const totalRegDiscReturnVat = data.reduce((s, r) => s + (r.regDiscReturnVat || 0), 0);
  const totalZeroRatedReturnBase = data.reduce((s, r) => s + (r.zeroRatedReturnBase || 0), 0);
  const vatOnReturns = data.reduce((s, r) => s + (r.vatAmount || 0), 0);
  const returnBaseAmount = data.reduce((sum, r) => sum + r.vatableSales + r.vatExemptSales + r.zeroRatedSales, 0);
  const cashReturnAmount = data
    .filter((r) => r.paymentType === 'Cash')
    .reduce((sum, r) => sum + (r.returnAmount || 0), 0);
  const cashReturnNetAmount = data
    .filter((r) => r.paymentType === 'Cash')
    .reduce((sum, r) => {
      const base = Math.abs((r.vatableSales || 0) + (r.vatExemptSales || 0) + (r.zeroRatedSales || 0));
      return sum + (base - (r.scReturnDiscount || 0) - (r.pwdReturnDiscount || 0));
    }, 0);
  const totalReturnVatExemptSales = data.reduce((s, r) => s + Math.abs(r.vatExemptSales || 0), 0);

  return {
    returns: data,
    totalReturnAmount,
    returnBaseAmount,
    cashReturnAmount,
    cashReturnNetAmount,
    totalReturnVatExemptSales,
    count: data.length,
    totalScReturnDiscount,
    totalPwdReturnDiscount,
    scReturnVatAdj: totalScReturnDiscount * (VAT_RATE / SENIOR_RATE),
    pwdReturnVatAdj: totalPwdReturnDiscount * (VAT_RATE / PWD_RATE),
    regDiscReturnVatAdj: totalRegDiscReturnVat,
    zeroRatedReturnVatAdj: totalZeroRatedReturnBase * VAT_RATE,
    vatOnReturns,
    beginningReturnSI,
    endingReturnSI,
  };
};

interface VoidSummaryItem {
  key: string;
  amount: number;
  paymentType: string;
  voidBase: number;
  voidVat: number;
  voidNo?: number | null;
  receiptNo?: string | number;
  receiptCycle: number;
  reason: string;
  cashier: string;
  timestamp: number;
  originalTransactionKey: string;
  isCancel?: boolean;
  isCrossDay?: boolean;
}

interface VoidSummaryResult {
  totalVoids: number;
  totalVoidBase: number;
  totalVoidVat: number;
  voids: VoidSummaryItem[];
  count: number;
  beginningVoidSI: string;
  endingVoidSI: string;
}

export const getVoidSummary = (voidsSnapshot: any): VoidSummaryResult => {
  let totalVoids = 0;
  let totalVoidBase = 0;
  let totalVoidVat = 0;
  const voids: VoidSummaryItem[] = [];

  if (voidsSnapshot && voidsSnapshot.forEach) {
    voidsSnapshot.forEach((voidTxn: any) => {
      const data = voidTxn.val();
      const voidKey = voidTxn.key;

      if (data.trainingMode) return;

      let isCrossDay = false;
      if (data.originalTransactionKey) {
        const voidDate = Moment.unix(parseInt(voidKey)).format('YYYY-MM-DD');
        const originalTxnDate = Moment.unix(parseInt(data.originalTransactionKey)).format('YYYY-MM-DD');
        if (voidDate !== originalTxnDate) {
          isCrossDay = true;
        }
      }

      if (data.isCancel) {
        voids.push({
          key: voidKey,
          amount: parseFloat(data.amount) || 0,
          paymentType: data.paymentType || 'Cash',
          voidBase: 0,
          voidVat: 0,
          voidNo: data.voidNo ?? null,
          receiptNo: data.receiptNo ?? '',
          receiptCycle: data.receiptCycle != null ? parseInt(data.receiptCycle, 10) : 0,
          reason: data.reason || '',
          cashier: data.cashier || '',
          timestamp: data.timestamp || 0,
          originalTransactionKey: data.originalTransactionKey || '',
          isCancel: true,
        });
        return;
      }

      const amount = parseFloat(data.amount) || 0;
      let voidBase = 0;
      let voidVat = 0;

      const items = data.items || [];
      if (items.length > 0) {
        for (const item of items) {
          if (!item) continue;
          const vatType = item._defaultVatType
            ? item._defaultVatType
            : item.zeroVAT
              ? 'vatExempt'
              : 'vatable';
          const totalPrice = (item.price || 0) * Math.abs(item.quantity || 1);
          const base = totalPrice / (1 + VAT_RATE);

          const pax = item?.paxDiscount;
          if (pax && typeof pax === 'object' && Object.keys(pax).length > 0) {
            const guestCount = Object.values(pax as any).reduce(
              (a: number, e: any) => a + (parseInt(e?.guestCount, 10) || 0),
              0
            );
            if (guestCount > 0) {
              for (const [paxDiscType, discObj] of Object.entries(pax as any)) {
                const seatCount = parseInt((discObj as any)?.guestCount, 10) || 0;
                if (seatCount <= 0) continue;
                const guestRatio = seatCount / guestCount;
                const proportionalBase = base * guestRatio;
                const discountType = normalizeDiscountType(paxDiscType);

                if (discountType === 'ntlAthlete') {
                  voidBase += proportionalBase * (1 - NAAC_RATE);
                  voidVat += proportionalBase * VAT_RATE;
                } else if (['senior', 'pwd', 'soloParent'].includes(discountType)) {
                  const discountRate =
                    discountType === 'senior'
                      ? SENIOR_RATE
                      : discountType === 'pwd'
                        ? PWD_RATE
                        : SOLO_PARENT_RATE;
                  voidBase += proportionalBase * (1 - discountRate);
                } else if (discountType === 'diplomat') {
                  voidBase += proportionalBase;
                } else if (discountType === 'regular') {
                  const discRate = (parseFloat((discObj as any)?.percent) || 0) / 100;
                  const discountedBase = proportionalBase * (1 - discRate);
                  voidBase += discountedBase;
                  voidVat += discountedBase * VAT_RATE;
                }
              }
              continue;
            }
          }

          const discountType = resolveDiscountType(item);
          if (vatType === 'vatable' && !['senior', 'pwd', 'soloParent', 'ntlAthlete', 'diplomat'].includes(discountType)) {
            if (discountType === 'regular') {
              const paxRate = resolveDiscountRate(item, discountType);
              const rawDiscount = item.discount || item.discountSubtotal || 0;
              const effectiveRate = paxRate > 0 ? paxRate : rawDiscount / 100;
              const discountedBase = base * (1 - effectiveRate);
              voidBase += discountedBase;
              voidVat += discountedBase * VAT_RATE;
            } else {
              voidBase += base;
              voidVat += base * VAT_RATE;
            }
          } else if (vatType === 'vatable' && discountType === 'ntlAthlete') {
            voidBase += base * (1 - NAAC_RATE);
            voidVat += base * VAT_RATE;
          } else if (vatType === 'vatExempt' || ['senior', 'pwd', 'soloParent'].includes(discountType)) {
            const discountRate = resolveDiscountRate(item, discountType);
            const exemptAmount =
              vatType === 'vatExempt'
                ? totalPrice
                : ['senior', 'pwd', 'soloParent'].includes(discountType)
                  ? base * (1 - discountRate)
                  : base;
            voidBase += exemptAmount;
          } else if (discountType === 'diplomat' || (vatType === 'zeroVAT' && !['senior', 'pwd', 'soloParent'].includes(discountType))) {
            voidBase += base;
          }
        }
      } else {
        voidBase = amount / (1 + VAT_RATE);
        voidVat = amount - voidBase;
      }

      totalVoids += amount;
      totalVoidBase += roundMoney(voidBase * 100) / 100;
      totalVoidVat += roundMoney(voidVat * 100) / 100;
      const receiptNo = data.receiptNo != null ? parseInt(data.receiptNo, 10) : null;
      const receiptCycle = data.receiptCycle != null ? parseInt(data.receiptCycle, 10) : 0;
      voids.push({
        key: voidKey,
        amount,
        paymentType: data.paymentType || 'Cash',
        voidBase,
        voidVat,
        voidNo: data.voidNo || null,
        receiptNo: data.receiptNo ?? '',
        receiptCycle,
        reason: data.reason || '',
        cashier: data.cashier || '',
        timestamp: data.timestamp || 0,
        originalTransactionKey: data.originalTransactionKey || '',
        isCrossDay,
      });
    });
  }

  const regularVoids = voids.filter((v) => !v.isCancel);
  const withVoidNo = regularVoids
    .map((v) => ({ ...v, effectiveVoidNo: v.voidNo ?? parseInt(v.key) }))
    .filter((v) => v.effectiveVoidNo != null);
  const sortedByVoidNo = [...withVoidNo].sort(
    (a, b) => (parseInt(a.effectiveVoidNo, 10) || 0) - (parseInt(b.effectiveVoidNo, 10) || 0)
  );
  const beginningVoidSI = sortedByVoidNo.length
    ? `00-${String(parseInt(sortedByVoidNo[0].effectiveVoidNo) || 0).padStart(6, '0')}`
    : '';
  const endingVoidSI = sortedByVoidNo.length
    ? `00-${String(parseInt(sortedByVoidNo[sortedByVoidNo.length - 1].effectiveVoidNo) || 0).padStart(6, '0')}`
    : '';

  return {
    totalVoids,
    totalVoidBase,
    totalVoidVat,
    voids,
    count: voids.length,
    beginningVoidSI,
    endingVoidSI,
  };
};

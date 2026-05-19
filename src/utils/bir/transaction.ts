import Moment from 'moment-timezone';
import Transaction from '../../models/Transaction';

const MP = Transaction.MONEY_PRECISION;

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

const isAdjustmentClone = (item: any): boolean => {
  if (!item) return false;
  const qty = Number(item.quantity || 0);
  if (qty >= 0) return false;
  return item.refund != null || item.return != null || item.index != null;
};

interface SalesBucket {
  vatable: number;
  vat: number;
  exempt: number;
  zeroRated: number;
}

interface TransactionSummaryItem {
  key: string;
  date: string;
  receiptNo: number | string | null;
  receiptCycle: number | string | null;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  grossSales: number;
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
      naac: number;
      soloParent: number;
      others: number;
    };
    returns: number;
    others: number;
  };
  paymentTypeTotals: { [key: string]: number };
  service: number;
  giftCardOverAmount: number;
  serviceCharge: number;
  soloParentChildDetails: {
    childName: string;
    childBirthDate: string;
    childAge: string;
  } | null;
}

export const getTransactionSummary = (snapshot: any): TransactionSummaryItem[] => {
  const data: TransactionSummaryItem[] = [];
  const vatExemptingDiscounts = ['senior', 'pwd', 'soloParent', 'commodity'];
  const zeroRatedDiscounts = ['diplomat'];

  const applySalesBucket = ({
    discountType,
    baseAmount,
    regularRate = 0,
    defaultVatType = 'vatable',
  }: {
    discountType: string;
    baseAmount: number;
    regularRate?: number;
    defaultVatType?: string;
  }): SalesBucket => {
    const dType = normalizeDiscountType(discountType || '');
    const base = Number(baseAmount) || 0;
    if (base <= 0) {
      return { vatable: 0, vat: 0, exempt: 0, zeroRated: 0 };
    }

    if (zeroRatedDiscounts.includes(dType) || defaultVatType === 'zeroVAT' || defaultVatType === 'zeroVat') {
      return { vatable: 0, vat: 0, exempt: 0, zeroRated: base };
    }

    if (vatExemptingDiscounts.includes(dType) || defaultVatType === 'vatExempt') {
      return { vatable: 0, vat: 0, exempt: base, zeroRated: 0 };
    }

    if (dType === 'regular') {
      const discountedBase = base * (1 - (Number(regularRate) || 0));
      return {
        vatable: discountedBase,
        vat: discountedBase * VAT_RATE,
        exempt: 0,
        zeroRated: 0,
      };
    }

    return {
      vatable: base,
      vat: base * VAT_RATE,
      exempt: 0,
      zeroRated: 0,
    };
  };

  snapshot.forEach((snap: any) => {
    const key = snap.key;
    const value = snap.val();

    if (value.trainingMode) return;

    const $txn = Transaction.asPristine({ key, val: value });

    let vatableSales = 0;
    let vatAmount = 0;
    let vatExemptSales = 0;
    let zeroRatedSales = 0;
    let deductions = {
      discount: { sc: 0, pwd: 0, naac: 0, soloParent: 0, others: 0 },
      returns: 0,
      voids: 0,
    };
    let adjustmentOnVat = {
      discount: { sc: 0, pwd: 0, naac: 0, soloParent: 0, others: 0 },
      returns: 0,
      others: 0,
    };
    let paymentTypeTotals: { [key: string]: number } = { Cash: 0 };
    let service = 0;
    let serviceCharge = 0;

    // Calculate service charge from items
    for (const $itm of $txn.items) {
      if (!$itm) continue;
      const orig = $itm.original || {};
      if (orig.refunded || orig.returned || orig.voided || orig.refund != null) continue;
      serviceCharge += ($itm.$service || 0) / MP;
    }

    // Process items
    for (const item of value.items) {
      if (isAdjustmentClone(item)) continue;

      const vatType = item._defaultVatType;
      const itemDiscType = normalizeDiscountType(item.individualDiscountType || '');
      const txnDiscType = normalizeDiscountType(item.transactionDiscountType || '');
      const discountType = itemDiscType || txnDiscType;
      const itemDiscount = item.discount || 0;
      const txnDiscountPct = item.discountSubtotal || 0;
      const discount = itemDiscount || txnDiscountPct;
      const totalPrice = item.price * item.quantity;
      const baseAmount = totalPrice / (1 + VAT_RATE);
      const refunded = item.refunded;
      const returned = item.returned;
      const refund = item.refund;
      const voided = item.voided;

      // Handle PAX discount items
      if (item.paxDiscount) {
        const isCommodity = item.isCommodity === true;
        const guestCount = Object.values(item.paxDiscount as any).reduce(
          (a: number, e: any) => a + (parseInt(e.guestCount, 10) || 0),
          0
        );

        for (const [paxDiscType, discObj] of Object.entries(item.paxDiscount as any)) {
          const guestRatio = (discObj as any).guestCount / guestCount;
          const proportionalAmount = baseAmount * guestRatio;
          const normalizedPaxType = normalizeDiscountType(paxDiscType);
          const discRate =
            (parseFloat((discObj as any).percent) || 0) / 100 ||
            (paxDiscType === 'senior' || paxDiscType === 'pwd'
              ? SENIOR_RATE
              : paxDiscType === 'ntl'
                ? NAAC_RATE
                : paxDiscType === 'sp'
                  ? SOLO_PARENT_RATE
                  : 0);

          const bucket = applySalesBucket({
            discountType: normalizedPaxType,
            baseAmount: proportionalAmount,
            regularRate: normalizedPaxType === 'regular' ? discRate : 0,
            defaultVatType: vatType,
          });

          vatableSales += bucket.vatable;
          vatAmount += bucket.vat;
          vatExemptSales += bucket.exempt;
          zeroRatedSales += bucket.zeroRated;

          if (normalizedPaxType === 'senior') {
            const scDisc = proportionalAmount * discRate;
            deductions.discount.sc += scDisc;
            if (!isCommodity) {
              adjustmentOnVat.discount.sc += scDisc * (VAT_RATE / SENIOR_RATE);
            }
          } else if (normalizedPaxType === 'pwd') {
            const pwdDisc = proportionalAmount * discRate;
            deductions.discount.pwd += pwdDisc;
            if (!isCommodity) {
              adjustmentOnVat.discount.pwd += pwdDisc * (VAT_RATE / PWD_RATE);
            }
          } else if (normalizedPaxType === 'ntlAthlete') {
            deductions.discount.naac += proportionalAmount * discRate;
            adjustmentOnVat.discount.naac += proportionalAmount * VAT_RATE;
          } else if (normalizedPaxType === 'soloParent') {
            const spDisc = proportionalAmount * discRate;
            deductions.discount.soloParent += spDisc;
            if (!isCommodity) {
              adjustmentOnVat.discount.soloParent += spDisc * (VAT_RATE / SOLO_PARENT_RATE);
            }
          } else if (normalizedPaxType === 'diplomat') {
            // Diplomat: handled by model
          } else if (normalizedPaxType === 'regular') {
            if (discRate > 0) {
              deductions.discount.others += proportionalAmount * discRate;
              adjustmentOnVat.discount.others += proportionalAmount * discRate * VAT_RATE;
            }
          }
        }
        continue;
      }

      // Regular item processing
      const effectiveDiscType = itemDiscType || txnDiscType;
      const regularRate = effectiveDiscType === 'regular' ? (Number(discount) || 0) / 100 : 0;
      const bucket = applySalesBucket({
        discountType: effectiveDiscType,
        baseAmount,
        regularRate,
        defaultVatType: vatType,
      });

      vatableSales += bucket.vatable;
      vatAmount += bucket.vat;
      vatExemptSales += bucket.exempt;
      zeroRatedSales += bucket.zeroRated;

      // Item-level discounts
      if (itemDiscType === 'senior') {
        deductions.discount.sc += baseAmount * SENIOR_RATE;
        adjustmentOnVat.discount.sc += baseAmount * SENIOR_RATE * (VAT_RATE / SENIOR_RATE);
      } else if (itemDiscType === 'pwd') {
        deductions.discount.pwd += baseAmount * PWD_RATE;
        adjustmentOnVat.discount.pwd += baseAmount * PWD_RATE * (VAT_RATE / PWD_RATE);
      } else if (itemDiscType === 'commodity') {
        deductions.discount.others += baseAmount * COMMODITY_RATE;
      } else if (itemDiscType === 'ntlAthlete') {
        deductions.discount.naac += baseAmount * NAAC_RATE;
        adjustmentOnVat.discount.naac += baseAmount * NAAC_RATE * (VAT_RATE / NAAC_RATE);
      } else if (itemDiscType === 'soloParent') {
        deductions.discount.soloParent += baseAmount * SOLO_PARENT_RATE;
        adjustmentOnVat.discount.soloParent += baseAmount * SOLO_PARENT_RATE * (VAT_RATE / SOLO_PARENT_RATE);
      } else if (itemDiscType === 'regular' && itemDiscount > 0) {
        deductions.discount.others += baseAmount * (itemDiscount / 100);
        adjustmentOnVat.discount.others += baseAmount * VAT_RATE * (itemDiscount / 100);
      }

      // Transaction-level discounts
      if (txnDiscType) {
        if (txnDiscType === 'senior') {
          deductions.discount.sc += baseAmount * SENIOR_RATE;
          adjustmentOnVat.discount.sc += baseAmount * SENIOR_RATE * (VAT_RATE / SENIOR_RATE);
        } else if (txnDiscType === 'pwd') {
          deductions.discount.pwd += baseAmount * PWD_RATE;
          adjustmentOnVat.discount.pwd += baseAmount * PWD_RATE * (VAT_RATE / PWD_RATE);
        } else if (txnDiscType === 'commodity') {
          deductions.discount.others += baseAmount * COMMODITY_RATE;
        } else if (txnDiscType === 'ntlAthlete') {
          deductions.discount.naac += baseAmount * NAAC_RATE;
          adjustmentOnVat.discount.naac += baseAmount * NAAC_RATE * (VAT_RATE / NAAC_RATE);
        } else if (txnDiscType === 'soloParent') {
          deductions.discount.soloParent += baseAmount * SOLO_PARENT_RATE;
          adjustmentOnVat.discount.soloParent += baseAmount * SOLO_PARENT_RATE * (VAT_RATE / SOLO_PARENT_RATE);
        } else if (txnDiscType === 'regular' && txnDiscountPct > 0) {
          deductions.discount.others += baseAmount * (txnDiscountPct / 100);
          adjustmentOnVat.discount.others += baseAmount * VAT_RATE * (txnDiscountPct / 100);
        }
      }

      // Returns
      if (returned && discountType === 'senior') {
        deductions.returns += baseAmount - baseAmount * SENIOR_RATE;
      } else if (returned && discountType === 'pwd') {
        deductions.returns += baseAmount - baseAmount * PWD_RATE;
      } else if (returned && discountType === 'commodity') {
        deductions.returns += baseAmount - baseAmount * COMMODITY_RATE;
      } else if (returned && discountType === 'ntlAthlete') {
        deductions.returns += baseAmount - baseAmount * NAAC_RATE;
        adjustmentOnVat.returns += baseAmount * VAT_RATE;
      } else if (returned && discountType === 'soloParent') {
        deductions.returns += baseAmount - baseAmount * SOLO_PARENT_RATE;
      } else if (returned && discountType === 'regular') {
        deductions.returns += baseAmount - baseAmount * (discount / 100);
        adjustmentOnVat.returns += baseAmount * VAT_RATE - baseAmount * VAT_RATE * (discount / 100);
      } else if (returned && (discountType === 'diplomat' || vatType === 'zeroVat')) {
        deductions.returns += baseAmount;
      } else if (returned) {
        deductions.returns += baseAmount;
        adjustmentOnVat.returns += baseAmount * VAT_RATE;
      }

      // Refunds
      if (refunded && discountType === 'senior') {
        deductions.returns += baseAmount - baseAmount * SENIOR_RATE;
      } else if (refunded && discountType === 'pwd') {
        deductions.returns += baseAmount - baseAmount * PWD_RATE;
      } else if (refunded && discountType === 'commodity') {
        deductions.returns += baseAmount - baseAmount * COMMODITY_RATE;
      } else if (refunded && discountType === 'ntlAthlete') {
        deductions.returns += baseAmount - baseAmount * NAAC_RATE;
      } else if (refunded && discountType === 'soloParent') {
        deductions.returns += baseAmount - baseAmount * SOLO_PARENT_RATE;
      } else if (refunded && discountType === 'regular') {
        deductions.returns += baseAmount - baseAmount * (discount / 100);
      } else if (refunded && (discountType === 'diplomat' || vatType === 'zeroVat')) {
        deductions.returns += baseAmount;
      } else if (refunded) {
        deductions.returns += baseAmount;
      }
    }

    // Payment totals
    if (value?.payments && typeof value.payments === 'object' && Object.keys(value.payments).length > 0) {
      for (const [type, amount] of Object.entries(value.payments as any)) {
        const amt = parseFloat(amount) || 0;
        paymentTypeTotals[type] = (paymentTypeTotals[type] || 0) + amt;
      }
    } else {
      const type = value.paymentType || 'Cash';
      const totalAmt = parseFloat(value.total) || 0;
      paymentTypeTotals[type] = (paymentTypeTotals[type] || 0) + totalAmt;
    }

    if (value.service) {
      service += parseFloat(value.service) || 0;
    }

    const date = Moment.unix(key).format('YYYY-MM-DD');
    const receiptNo = value.receiptNo;
    const receiptCycle = value.receiptCycle;

    let giftCardOverAmount = 0;
    if (value.paymentType === 'Gift Card' && value.giftCard) {
      giftCardOverAmount = value.giftCard.overUnderAmount || 0;
    }

    // Solo parent child details
    let soloParentChildDetails = null;
    if (deductions.discount.soloParent > 0) {
      const meta = value.soloParentMetadata || value.soloParentDetails;
      const spBlock = value.items?.[0]?.paxDiscount?.sp;
      if (meta) {
        soloParentChildDetails = {
          childName: meta.childName || '',
          childBirthDate: meta.childBirthDate || '',
          childAge: meta.childAge != null ? String(meta.childAge) : '',
        };
      } else if (spBlock) {
        const childNames = (spBlock.childNames || spBlock.childName || '')
          .split(/[\n,]+/)
          .map((s: string) => s.trim())
          .filter(Boolean);
        const childBirthDates = (spBlock.childBirthDates || spBlock.childBirthDate || '')
          .split(/[\n,]+/)
          .map((s: string) => s.trim())
          .filter(Boolean);
        const childAges = (spBlock.childAges || (spBlock.childAge != null ? String(spBlock.childAge) : ''))
          .split(/[\n,]+/)
          .map((s: string) => s.trim())
          .filter(Boolean);
        soloParentChildDetails = {
          childName: childNames.join(', '),
          childBirthDate: childBirthDates.join(', '),
          childAge: childAges.join(', '),
        };
      }
    }

    const grossSales = ($txn.$baseSales || 0) / MP;

    data.push({
      key,
      date,
      receiptNo,
      receiptCycle,
      vatableSales,
      vatAmount,
      vatExemptSales,
      zeroRatedSales,
      grossSales,
      deductions,
      adjustmentOnVat,
      paymentTypeTotals,
      service,
      giftCardOverAmount,
      serviceCharge,
      soloParentChildDetails,
    });
  });

  return data;
};

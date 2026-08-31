/**
 * Money math for the BIR reports, ported from the mobile app
 * (utakmobileBIR/src/HelperFunctions/roundMoney.js and calcPaxDiscount.js).
 *
 * Two layers live here:
 *  - rounding primitives, which keep every monetary value at 2 decimal places
 *    (cents; PHP 100.50 = 10050 cents);
 *  - calcPaxDiscount, the canonical per-pax discount split built on them.
 */

/** Money precision constant: 100 (1 PHP = 100 cents). */
export const MONEY_PRECISION = 100;

/**
 * Round a monetary value to the nearest cent, preserving sign.
 * Works with both cent-based values and PHP-based values.
 */
export function roundMoney(value: number | string | null | undefined): number {
  const numValue = parseFloat(String(value)) || 0;
  const rounded = Math.round(Math.abs(numValue));
  return numValue < 0 ? -1 * rounded : rounded;
}

/** Round a value in cents and convert to PHP units. */
export function roundMoneyToPHP(valueInCents: number | string): number {
  return roundMoney(valueInCents) / MONEY_PRECISION;
}

/** Convert a PHP amount to rounded cents. */
export function phpToCents(phpValue: number | string): number {
  return roundMoney((parseFloat(String(phpValue)) || 0) * MONEY_PRECISION);
}

/** Sum an array of monetary values and round the result (avoids float drift). */
export function sumAndRound(values: (number | string)[]): number {
  if (!Array.isArray(values)) return roundMoney(0);
  const sum = values.reduce((acc: number, val) => acc + (parseFloat(String(val)) || 0), 0);
  return roundMoney(sum);
}

/** Multiply a base by a rate and round (discount / tax calculations). */
export function multiplyAndRound(base: number | string, rate: number | string): number {
  const baseNum = parseFloat(String(base)) || 0;
  const rateNum = parseFloat(String(rate)) || 0;
  return roundMoney(baseNum * rateNum);
}

/** Divide and round (VAT-exclusive calculations, e.g. divisor 1.12). */
export function divideAndRound(value: number | string, divisor: number | string): number {
  const valueNum = parseFloat(String(value)) || 0;
  const divisorNum = parseFloat(String(divisor)) || 1;
  if (divisorNum === 0) return roundMoney(0);
  return roundMoney(valueNum / divisorNum);
}

/** True when the value carries more than 2 decimal places. */
export function needsRounding(value: number | string): boolean {
  const numValue = parseFloat(String(value)) || 0;
  const rounded = roundMoney(numValue);
  return Math.abs(numValue - rounded) > 0.001;
}

/* ------------------------------------------------------------------ *
 * Pax discount
 *
 * Accumulates per-part values as unrounded floats and rounds only the
 * final sums, so the totals match the device (e.g. VAT 64.29, not 64.28).
 * ------------------------------------------------------------------ */

const COMMODITY_DISC_TYPES = ['senior', 'pwd', 'medalOfValor'];
const ZERO_RATED_DISC_TYPES = ['diplomat'];
const VATABLE_PAX_TYPES = ['ntl'];
const DEFAULT_RATES: Record<string, number> = {
  senior: 0.2,
  pwd: 0.2,
  sp: 0.1,
  ntl: 0.2,
  diplomat: 0,
  medalOfValor: 0.2,
};

export interface PaxPart {
  vatType: string;
  discType: string;
  discRate: number;
  guestCount: number;
  vatExemption: number;
  grossSales: number;
  discount: number;
  netSales: number;
  vat: number;
  service: number;
  total: number;
}

export interface PaxDiscountResult {
  guestCount: number;
  values: Record<string, PaxPart>;
  vatExemption: number;
  discount: number;
  vat: number;
  service: number;
  grossSales: number;
  netSales: number;
  total: number;
}

export function calcPaxDiscount(
  val: any,
  { vatRate = 0.12, svcRate = 0 }: { vatRate?: number; svcRate?: number } = {},
): PaxDiscountResult | null {
  const _qp = 100 * (parseFloat(val.quantity) || 1) * (parseFloat(val.price) || 0);
  const defaultVatType = val.vatType || 'vatable';
  // Guard against null blocks: Firebase stores a cleared paxDiscount block as
  // null, so iterating without this throws (Cannot read 'guestCount' of null),
  // which propagated up through new TransactionItem and blanked the whole
  // Transactions reversal panel for PAX/MOV transactions.
  const guestCount = Object.values(val.paxDiscount as Record<string, any>).reduce(
    (a: number, e: any) => a + (e ? parseInt(e.guestCount, 10) || 0 : 0),
    0,
  );
  if (!guestCount) return null;

  const isCommodity = val.isCommodity === true;
  const values: Record<string, PaxPart> = {};
  let vatExemption = 0;
  let discount = 0;
  let vat = 0;
  let service = 0;
  let grossSales = 0;
  let netSales = 0;
  let total = 0;

  for (const [discType, discObj] of Object.entries(val.paxDiscount as Record<string, any>)) {
    if (!discObj) continue; // skip cleared (null) blocks — see guestCount note above
    const guestRatio = (parseInt(discObj.guestCount, 10) || 0) / guestCount;
    const proportionalAmount = _qp * guestRatio; // unrounded float
    const isCommodityDisc = isCommodity && COMMODITY_DISC_TYPES.includes(discType);
    const isNaac = discType === 'ntl';
    const isRegular = discType === 'regular';

    const partVatType = isCommodityDisc
      ? defaultVatType
      : ZERO_RATED_DISC_TYPES.includes(discType)
        ? 'zeroVat'
        : VATABLE_PAX_TYPES.includes(discType)
          ? defaultVatType
          : discType !== 'regular' || val.zeroVAT
            ? 'vatExempt'
            : defaultVatType;

    const __willRemoveVat =
      !isCommodityDisc &&
      !isNaac &&
      !val.zeroVAT &&
      defaultVatType === 'vatable' &&
      discType !== 'regular';

    // VAT-exclusive base: kept as float (no rounding here)
    const baseAmount =
      defaultVatType === 'vatable' ? proportionalAmount / (1 + vatRate) : proportionalAmount;

    const discRate = (() => {
      const maybeRate = parseFloat(discObj.percent) / 100;
      if (!isNaN(maybeRate)) return maybeRate;
      if (isRegular) return 0;
      if (isCommodity && COMMODITY_DISC_TYPES.includes(discType)) return 0.05;
      return DEFAULT_RATES[discType] ?? 0;
    })();
    const is100Pct = discRate >= 1 && (isRegular || isNaac) && defaultVatType === 'vatable';

    // Per-part values: unrounded floats (accumulated, rounded only at the end)
    const pVatExemption = __willRemoveVat ? baseAmount * vatRate : 0;
    const pGrossSales = baseAmount;
    const pDiscount = is100Pct
      ? proportionalAmount
      : isRegular
        ? proportionalAmount * discRate
        : baseAmount * discRate;
    const pNetSales = is100Pct
      ? 0
      : isRegular
        ? baseAmount * (1 - discRate)
        : pGrossSales - pDiscount;
    const pVat =
      defaultVatType !== 'vatable' || is100Pct
        ? 0
        : isRegular
          ? pNetSales * vatRate
          : isNaac
            ? pGrossSales * vatRate
            : 0;
    const pService = pNetSales * svcRate;
    const pTotal = pNetSales + pService + pVat;

    values[discType] = {
      vatType: partVatType,
      discType,
      discRate,
      guestCount: parseInt(discObj.guestCount, 10) || 0,
      vatExemption: pVatExemption,
      grossSales: pGrossSales,
      discount: pDiscount,
      netSales: pNetSales,
      vat: pVat,
      service: pService,
      total: pTotal,
    };

    vatExemption += pVatExemption;
    discount += pDiscount;
    vat += pVat;
    service += pService;
    grossSales += pGrossSales;
    netSales += pNetSales;
    total += pTotal;
  }

  // Round only the final sums → produces QA-expected values
  return {
    guestCount,
    values,
    vatExemption: roundMoney(vatExemption),
    discount: roundMoney(discount),
    vat: roundMoney(vat),
    service: roundMoney(service),
    grossSales: roundMoney(grossSales),
    netSales: roundMoney(netSales),
    total: roundMoney(total),
  };
}


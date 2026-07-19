/**
 * BIR accumulated-sales 12-digit rollover helpers, ported from the mobile app
 * (utakmobileBIR/src/mod_temp_bir/receipts/reading.ts, lines 488-505).
 *
 * The accumulated grand-total sales figure printed on X/Z/Custom readings must
 * wrap once it reaches the 12-digit maximum 9,999,999,999.99. When the running
 * total hits the threshold the counter resets and the receipt shows the EXCESS
 * past the max, not the raw capped value.
 */

/** 10-digit max: 9,999,999,999.99 (XXXXXXXXXX.XX). Reset triggers when reached. */
export const ACCUMULATED_SALES_RESET_THRESHOLD = 10000000000;

/**
 * Wrap a value into the 0.01 .. 9,999,999,999.99 window using integer-cent
 * arithmetic (avoids float error; first excess value is 0.01 when total is
 * exactly 10,000,000,000.00).
 */
export const accExcess = (val: number): number => {
  const cents = Math.round((Number(val) || 0) * 100);
  if (cents <= 0) return 0;
  // 12-digit max = 9,999,999,999.99 = (THRESHOLD * 100 - 1) cents
  const maxCents = Math.round(ACCUMULATED_SALES_RESET_THRESHOLD * 100) - 1;
  return (((cents - 1) % maxCents) + 1) / 100;
};

export interface AccumulatedSalesResult {
  /** Previous Acc. Sales to print (wrapped if the max was hit). */
  previousAccSales: number;
  /** Present Acc. Sales to print (= previous + gross for the period, wrapped). */
  presentAccSales: number;
  /** Whether the wrap/reset engaged for this reading. */
  wouldHitReset: boolean;
}

/**
 * Compute the Previous/Present Accumulated Sales pair for a reading.
 *
 * @param rawPreviousAccSales  Accumulated sales BEFORE this period. Callers build
 *   this as `settings.accumulatedSalesCarryover + Σ grossSales(startAfterReset..sttS)`
 *   where `startAfterReset = Number(settings.accumulatedSalesResetAt || '0') + 1`.
 * @param grossSalesForPeriod  Gross (pre-discount, VAT-inclusive) sales for this period.
 * @param accumulatedSalesResetTriggered  Force the wrap (e.g. an auto-reset fired this period).
 */
export const computeAccumulatedSales = (
  rawPreviousAccSales: number,
  grossSalesForPeriod: number,
  accumulatedSalesResetTriggered = false,
): AccumulatedSalesResult => {
  const rawPrev = Number(rawPreviousAccSales) || 0;
  const gross = Number(grossSalesForPeriod) || 0;
  const totalAccRounded = Math.round((rawPrev + gross) * 100) / 100;
  const wouldHitReset =
    accumulatedSalesResetTriggered || totalAccRounded >= ACCUMULATED_SALES_RESET_THRESHOLD;
  return {
    previousAccSales: wouldHitReset ? accExcess(rawPrev) : rawPrev,
    presentAccSales: wouldHitReset ? accExcess(totalAccRounded) : totalAccRounded,
    wouldHitReset,
  };
};

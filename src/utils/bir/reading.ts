/**
 * Reading-time domain helpers, both ported from the mobile app: the
 * accumulated-sales rollover and the merchant-defined non-cash tender catalog.
 */

/* ------------------------------------------------------------------ */

/**
 * BIR accumulated-sales 12-digit rollover, ported from the mobile app
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

/* ------------------------------------------------------------------ */

/**
 * Merchant-defined non-cash tenders — the pure half, ported from the mobile app
 * (utakmobileBIR/src/HelperFunctions/tenderCatalog.js).
 *
 * Functions here take `settings` explicitly, and take it FIRST, so no call site
 * quietly relies on an ambient default.
 */

export interface Tender {
  id?: string;
  name: string;
  requiresReference?: boolean;
  active?: boolean;
  color?: string;
}

/**
 * Seeded on first use so a merchant has the two aggregators without typing them.
 * Not written to settings until they edit the list — an untouched account keeps
 * an empty node.
 */
export const DEFAULT_TENDERS: Tender[] = [
  { id: 'foodpanda', name: 'FoodPanda', requiresReference: true, active: true, color: '#FF2B85' },
  { id: 'grabfood', name: 'GrabFood', requiresReference: true, active: true, color: '#00B14F' },
];

/** Button colour when a tender has none of its own. */
export const DEFAULT_TENDER_COLOR = '#4db6ac';

/**
 * Every configured tender, including DEACTIVATED ones: switching a tender off
 * does not un-take the money it collected earlier in the same period.
 */
export const getAllTendersFrom = (settings: any): Tender[] => {
  const list = settings && settings.customTenders;
  return Array.isArray(list) ? list : DEFAULT_TENDERS;
};

/** Colour for a tender's button, falling back to the seeded brand colour. */
export const tenderColor = (tender: Tender | null | undefined): string => {
  if (!tender) return DEFAULT_TENDER_COLOR;
  if (tender.color) return tender.color;
  const seeded = DEFAULT_TENDERS.find((t) => t.id === tender.id || t.name === tender.name);
  return seeded?.color || DEFAULT_TENDER_COLOR;
};

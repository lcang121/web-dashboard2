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

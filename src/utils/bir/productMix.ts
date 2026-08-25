/**
 * Product Mix aggregation, ported from the mobile app
 * (utakmobileBIR/src/HelperFunctions/productMix.js).
 */

const round2 = (n: any): number => Math.round((Number(n) || 0) * 100) / 100;

const isExcludedProductMixItem = (item: any): boolean => {
  if (!item) return true;
  const qty = Number(item.quantity) || 0;
  if (qty <= 0) return true;
  if (item.refunded || item.returned || item.voided) return true;
  if (item.refund != null || item.return != null) return true;
  return false;
};

const toProductMixKey = (item: any): string => {
  const title = String(item?.title || '(unnamed)').trim() || '(unnamed)';
  const option = String(item?.option || '').trim();
  return `${title}|${option}`;
};

export interface ProductMixRow {
  item: string;
  option: string;
  category: string;
  quantity: number;
  sales: number;
}

export interface ProductMixResult {
  rows: ProductMixRow[];
  totalQty: number;
  totalSales: number;
}

export const aggregateProductMixFromTransactions = (
  transactions: any[] = [],
): ProductMixResult => {
  const mix = new Map<string, ProductMixRow>();

  for (const txn of transactions) {
    if (!txn || txn.trainingMode) continue;
    const itemsList = Array.isArray(txn.items) ? txn.items : Object.values(txn.items || {});
    if (!itemsList.length) continue;

    for (const item of itemsList as any[]) {
      if (isExcludedProductMixItem(item)) continue;

      const key = toProductMixKey(item);
      const title = String(item?.title || '(unnamed)').trim() || '(unnamed)';
      const option = String(item?.option || '').trim();
      const category = String(item?.categoryOriginal || item?.category || '').trim();
      const qty = Number(item.quantity) || 0;
      const sales = qty * (Number(item.price) || 0);

      const cur =
        mix.get(key) ||
        ({
          item: title,
          option,
          category,
          quantity: 0,
          sales: 0,
        } as ProductMixRow);

      cur.quantity += qty;
      cur.sales += sales;
      mix.set(key, cur);
    }
  }

  const rows = [...mix.values()].sort((a, b) => b.sales - a.sales);
  const totalQty = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const totalSales = rows.reduce((s, r) => s + (Number(r.sales) || 0), 0);

  return {
    rows: rows.map((r) => ({ ...r, sales: round2(r.sales) })),
    totalQty,
    totalSales: round2(totalSales),
  };
};

export const aggregateProductMixFromSnapshot = (txnSnapshot: any): ProductMixResult => {
  const transactions: any[] = [];
  if (txnSnapshot && txnSnapshot.exists()) {
    txnSnapshot.forEach((snap: any) => {
      transactions.push(snap.val());
    });
  }
  return aggregateProductMixFromTransactions(transactions);
};

// TypeScript port of mobile Transaction.js — keep in sync with utakmobileBIR
import TransactionItem, { TransactionItemValue } from './TransactionItem';
import { roundMoney } from '../utils/bir/roundMoney';

const roundableItemProps = [
  '$amountDue', '__itmTotal',
  '$baseSales', '$grossSales', '$itmDiscount', '$txnDiscount', '$discount',
  '$service', '$subtotal', '$netSales', '$total', '$vat', '$vatableSales',
  '$vatExemptSales', '$zeroRatedSales',
  'itmDiscount', 'vatExemption', 'txnDiscount', 'totalCost',
  '__txnVatExemption',
] as const;

const summableItemProps = [
  '$baseSales', '$grossSales', '$itmDiscount', '$txnDiscount', '$discount',
  '$service', '$subtotal', '$netSales', '$total', '$vat', '$vatableSales',
  '$vatExemptSales', '$zeroRatedSales',
  'itmDiscount', 'vatExemption', 'txnDiscount', 'quantity', 'totalCost',
  '__txnVatExemption',
  '$amountDue', '__itmTotal',
] as const;

export interface TransactionValue {
  items?: Record<string, TransactionItemValue> | TransactionItemValue[];
  total?: number | string;
  totalCost?: number | string;
  paymentType?: string;
  paymentReceived?: number;
  payments?: Record<string, number>;
  [key: string]: any;
}

class Transaction {
  static readonly MONEY_PRECISION = TransactionItem.MONEY_PRECISION;

  // Ports of the mobile Transaction.js static factories. Build a Transaction,
  // then keep only the relevant items and reassign `items` so the sums recompute.
  static asPristine({ val, key = null, ...opts }: { val: TransactionValue; key?: number | string | null; [k: string]: any }): Transaction {
    const $txn = new Transaction({ val, key, ...opts });
    const $itms: (TransactionItem | null)[] = [];
    for (const $itm of $txn.items) {
      if (!$itm || $itm.quantity <= 0) continue;
      $itms.push($itm);
    }
    $txn.items = $itms;
    return $txn;
  }

  static asAdjustment({ val, key = null, ...opts }: { val: TransactionValue; key?: number | string | null; [k: string]: any }): Transaction {
    const $txn = new Transaction({ val, key, ...opts });
    const $itms: (TransactionItem | null)[] = [];
    const refundKey = (val as any).originalRefundKey != null ? String((val as any).originalRefundKey) : String(key);
    for (const $itm of $txn.items) {
      if ($itm && $itm.quantity <= 0 && String($itm.original.refund) === refundKey) {
        $itms.push($itm);
      }
    }
    $txn.items = $itms;
    return $txn;
  }

  static asReturnAdjustment({ val, key = null, ...opts }: { val: TransactionValue; key?: number | string | null; [k: string]: any }): Transaction {
    const $txn = new Transaction({ val, key, ...opts });
    const $itms: (TransactionItem | null)[] = [];
    const returnKey = String(key);
    for (const $itm of $txn.items) {
      if ($itm && $itm.quantity <= 0 && String($itm.original.return) === returnKey) {
        $itms.push($itm);
      }
    }
    $txn.items = $itms;
    return $txn;
  }

  key: number | string | null;
  original: Record<string, any>;
  paymentType: string;
  payments: { type: string; value: number }[];

  // Summed from items
  $baseSales: number = 0;
  $grossSales: number = 0;
  $itmDiscount: number = 0;
  $txnDiscount: number = 0;
  $discount: number = 0;
  $service: number = 0;
  $subtotal: number = 0;
  $netSales: number = 0;
  $total: number = 0;
  $vat: number = 0;
  $vatableSales: number = 0;
  $vatExemptSales: number = 0;
  $zeroRatedSales: number = 0;
  itmDiscount: number = 0;
  vatExemption: number = 0;
  txnDiscount: number = 0;
  quantity: number = 0;
  totalCost: number = 0;
  __txnVatExemption: number = 0;
  $amountDue: number = 0;
  __itmTotal: number = 0;

  svcRate: number = 0;
  txnDiscType: string = 'regular';
  txnDiscRate: number = 0;
  _defaultVatType: string | undefined;

  total!: number;
  _total!: number;
  _totalCost!: number;

  private _items!: (TransactionItem | null)[];

  constructor({ val, key = null, ...opts }: { val: TransactionValue; key?: number | string | null; [k: string]: any }) {
    this.key = key;
    this.original = JSON.parse(JSON.stringify(val));
    this.paymentType = val.paymentType || 'Cash';

    const items: (TransactionItem | null)[] = [];
    const rawItems = val.items || {};
    const itemOpts = (opts as any).itemOpts || {};

    if (Array.isArray(rawItems)) {
      rawItems.forEach((item, i) => {
        items[i] = item && typeof item === 'object'
          ? new TransactionItem({ ...itemOpts, val: item, key: i })
          : null;
      });
    } else {
      for (const [k, item] of Object.entries(rawItems)) {
        const idx = parseInt(k, 10);
        items[isNaN(idx) ? items.length : idx] = item && typeof item === 'object'
          ? new TransactionItem({ ...itemOpts, val: item as TransactionItemValue, key: isNaN(idx) ? k : idx })
          : null;
      }
    }
    this.items = items;

    if ('total' in val) {
      this.total = roundMoney(TransactionItem.moneyOrZero(val.total));
    }
    if ('totalCost' in val) {
      this.totalCost = TransactionItem.moneyOrZero(val.totalCost as any);
    }

    this.payments = Object.entries(val.payments || {}).map(([k, v]) => ({
      type: k,
      value: this.total && roundMoney(TransactionItem.moneyOrZero(v)),
    }));
  }

  get items(): (TransactionItem | null)[] {
    return this._items;
  }

  set items(v: (TransactionItem | null)[]) {
    const canCollapse = ~v.findIndex(Boolean);
    if (canCollapse) {
      const wontCollapse = ~v.findIndex(
        item =>
          item &&
          (item.quantity < 0 ||
            'refund' in item.original ||
            'refunded' in item.original ||
            'index' in item.original)
      );
      if (!wontCollapse) v = v.filter(Boolean) as (TransactionItem | null)[];
    }
    v = v.map((item, i) => {
      if (!item) return null;
      item.key = i;
      return item;
    });

    for (const k of summableItemProps) (this as any)[k] = 0;
    this.svcRate = 0;
    this.txnDiscType = 'regular';
    this.txnDiscRate = 0;
    this._defaultVatType = undefined;

    for (const item of v) {
      if (!item) continue;
      for (const k of summableItemProps) (this as any)[k] += (item as any)[k];
      this.svcRate = item.svcRate;
      this.txnDiscType = item.txnDiscType;
      this.txnDiscRate = item.txnDiscRate;
      this._defaultVatType = item._defaultVatType;
    }
    for (const k of roundableItemProps) (this as any)[k] = roundMoney((this as any)[k]);
    this._items = v;

    // NAAC amount due is driven off base sales rather than the per-item
    // netSales + VAT sum (mirrors mobile Transaction.js). Mobile also carries a
    // `v[0]?.paxDiscount` branch ahead of this one, but TransactionItem never
    // exposes `paxDiscount` (it lives under `.original`), so that branch is
    // inert on the device: a PAX transaction falls through to `$amountDue`,
    // which already sums each item's rounded `_parts.total`. Reproducing the
    // branch here would make web disagree with the device, so it is omitted.
    const hasNaac =
      this.txnDiscType === 'ntlAthlete' ||
      v.some(item => item?.itmDiscType === 'ntlAthlete');
    if (hasNaac) {
      this.$amountDue = roundMoney(roundMoney(this.$baseSales - this.discount) + this.$service);
    }
    this.total = this.$amountDue;
    this._total = this.total;
    this._totalCost = this.totalCost;
  }

  get defaultVatType(): string {
    return this._defaultVatType || 'vatable';
  }

  get discount(): number {
    if (this._items?.[0]?._parts) {
      return roundMoney(this._items.reduce((a, item) => a + (item?._parts?.discount ?? 0), 0));
    }
    return this.itmDiscount + this.txnDiscount;
  }

  get __txnEffDisc(): number {
    return roundMoney(this.__txnVatExemption + this.txnDiscount);
  }

  get service(): number {
    return this.$service;
  }

  get netSales(): number {
    return this.$netSales + this.$vat;
  }

  get grossSales(): number {
    return this.$baseSales - this.vatExemption;
  }

  get vat(): number {
    return this.$vat;
  }

  get paymentReceived(): number {
    return roundMoney(
      TransactionItem.MONEY_PRECISION * (this.original.paymentReceived || 0) || this.total || 0
    );
  }

  getDisplayValue(property: string): number {
    const value = (this as any)[property];
    if (typeof value !== 'number') return 0;
    return value / Transaction.MONEY_PRECISION;
  }

  getFormattedCurrency(property: string): string {
    const value = this.getDisplayValue(property);
    return '₱' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

export default Transaction;

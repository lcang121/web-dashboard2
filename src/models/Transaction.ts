// Web-compatible Transaction model based on mobile implementation
// This provides the same structure and calculated properties as the mobile Transaction model

export interface TransactionItem {
  key?: number | string;
  quantity: number;
  price: number;
  discount?: number;
  service?: number;
  vatType?: 'vatable' | 'vatExempt' | 'zeroRated';
  transactionDiscountType?: string;
  discountSubtotal?: number;
  original?: any;
}

export interface TransactionPayment {
  type: string;
  value: number;
}

export interface RawTransactionData {
  items?: { [key: string]: any } | any[];
  total?: number;
  totalCost?: number;
  paymentType?: string;
  paymentReceived?: number;
  payments?: { [key: string]: number };
  service?: number;
  discount?: number;
  manualReference?: string;
  receiptNo?: string;
  [key: string]: any;
}

export class Transaction {
  static readonly MONEY_PRECISION = 10000;

  public key: number | string | null;
  public original: RawTransactionData;
  public paymentType: string;
  public items: TransactionItem[];
  public payments: TransactionPayment[];
  public total: number;
  public totalCost: number;

  // Computed properties (similar to mobile version)
  public $amountDue: number = 0;
  public $service: number = 0;
  public $discount: number = 0;
  public $netSales: number = 0;
  public $grossSales: number = 0;
  public $baseSales: number = 0;
  public $vat: number = 0;
  public $vatableSales: number = 0;
  public $vatExemptSales: number = 0;
  public $zeroRatedSales: number = 0;
  public $subtotal: number = 0;

  constructor({ val, key = null }: { val: RawTransactionData; key?: number | string | null }) {
    this.key = key;
    this.original = JSON.parse(JSON.stringify(val));
    this.paymentType = val.paymentType || 'Cash';

    // Process items
    this.items = [];
    const rawItems = val.items || {};
    if (Array.isArray(rawItems)) {
      rawItems.forEach((item, index) => {
        if (item && typeof item === 'object') {
          this.items.push(this.processItem(item, index));
        }
      });
    } else if (typeof rawItems === 'object') {
      Object.entries(rawItems).forEach(([key, item]) => {
        if (item && typeof item === 'object') {
          this.items.push(this.processItem(item, key));
        }
      });
    }

    // Set totals
    this.total = val.total ? this.round(this.moneyOrZero(val.total)) : 0;
    this.totalCost = val.totalCost ? this.moneyOrZero(val.totalCost) : 0;

    // Process payments
    this.payments = Object.entries(val.payments || {}).map(([key, val]) => ({
      type: key,
      value: this.total && this.round(this.moneyOrZero(val)),
    }));

    // Calculate computed properties
    this.calculateComputedProperties();
  }

  private processItem(rawItem: any, key: number | string): TransactionItem {
    return {
      key,
      quantity: parseFloat(rawItem.quantity) || 1,
      price: this.moneyOrZero(rawItem.price),
      discount: this.moneyOrZero(rawItem.discount),
      service: this.moneyOrZero(rawItem.service),
      vatType: rawItem.vatType || 'vatable',
      transactionDiscountType: rawItem.transactionDiscountType,
      discountSubtotal: parseFloat(rawItem.discountSubtotal) || 0,
      original: rawItem,
    };
  }

  private calculateComputedProperties() {
    // Reset computed properties
    this.$service = 0;
    this.$discount = 0;
    this.$netSales = 0;
    this.$grossSales = 0;
    this.$baseSales = 0;
    this.$vat = 0;
    this.$vatableSales = 0;
    this.$vatExemptSales = 0;
    this.$zeroRatedSales = 0;
    this.$subtotal = 0;

    // Calculate from items
    for (const item of this.items) {
      const itemTotal = (item.price * item.quantity);
      const itemDiscount = item.discount || 0;
      const itemService = item.service || 0;
      const itemNet = itemTotal - itemDiscount + itemService;

      this.$subtotal += itemTotal;
      this.$discount += itemDiscount;
      this.$service += itemService;

      // VAT calculations based on item type
      switch (item.vatType) {
        case 'vatable':
          const vatableAmount = itemNet / 1.12; // Assuming 12% VAT
          this.$vatableSales += vatableAmount;
          this.$vat += (itemNet - vatableAmount);
          break;
        case 'vatExempt':
          this.$vatExemptSales += itemNet;
          break;
        case 'zeroRated':
          this.$zeroRatedSales += itemNet;
          break;
      }

      this.$netSales += itemNet;
    }

    // Final calculations
    this.$grossSales = this.$vatableSales + this.$vatExemptSales + this.$zeroRatedSales;
    this.$baseSales = this.$grossSales + this.$discount;
    this.$amountDue = this.$netSales;

    // Round all money values
    this.$amountDue = this.round(this.$amountDue);
    this.$service = this.round(this.$service);
    this.$discount = this.round(this.$discount);
    this.$netSales = this.round(this.$netSales);
    this.$grossSales = this.round(this.$grossSales);
    this.$baseSales = this.round(this.$baseSales);
    this.$vat = this.round(this.$vat);
    this.$vatableSales = this.round(this.$vatableSales);
    this.$vatExemptSales = this.round(this.$vatExemptSales);
    this.$zeroRatedSales = this.round(this.$zeroRatedSales);
    this.$subtotal = this.round(this.$subtotal);

    // If we have an explicit total from the original data, use that
    if (this.original.total) {
      this.total = this.round(this.moneyOrZero(this.original.total));
      this.$amountDue = this.total;
    } else {
      this.total = this.$amountDue;
    }
  }

  // Helper methods (similar to mobile Item class)
  private moneyOrZero(value: any): number {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num * Transaction.MONEY_PRECISION;
  }

  private round(value: number): number {
    return Math.round(value);
  }

  // Getters for compatibility with mobile version
  get service(): number {
    return this.$service;
  }

  get discount(): number {
    return this.$discount;
  }

  get netSales(): number {
    return this.$netSales;
  }

  get grossSales(): number {
    return this.$grossSales;
  }

  get vat(): number {
    return this.$vat;
  }

  get paymentReceived(): number {
    return this.round(
      Transaction.MONEY_PRECISION * (this.original.paymentReceived || 0) ||
        this.total ||
        0
    );
  }

  // Static helper methods
  static createFromFirebaseData(key: string | number, val: any): Transaction {
    return new Transaction({ key, val });
  }

  static createFromPlainObject(data: any): Transaction {
    return new Transaction({
      key: data.key,
      val: data
    });
  }

  // Helper to convert to display format (dividing by MONEY_PRECISION)
  getDisplayValue(property: keyof Transaction): number {
    const value = this[property] as number;
    return value / Transaction.MONEY_PRECISION;
  }

  // Get formatted currency display
  getFormattedCurrency(property: keyof Transaction): string {
    const value = this.getDisplayValue(property);
    return '₱' + value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
}

export default Transaction;
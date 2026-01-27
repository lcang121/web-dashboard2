import Transaction from '../models/Transaction';
import moment from 'moment-timezone';

// Interfaces for chart data
export interface RevenueData {
  totalRevenue: number;
  netSales: number;
  vatAmount: number;
  totalTransactions: number;
  averageTransaction: number;
  revenueChange: number;
}

export interface SalesDataPoint {
  date: string;
  totalSales: number;
  netSales: number;
  vatAmount: number;
  transactions: number;
}

export interface PaymentMethodData {
  name: string;
  value: number;
  count: number;
  percentage: number;
}

export interface SalesBreakdownData {
  category: string;
  vatableSales: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  discounts: number;
  serviceCharges: number;
}

/**
 * Process transactions to generate revenue overview data
 */
export function generateRevenueOverview(transactions: Transaction[], previousPeriodTransactions: Transaction[] = []): RevenueData {
  const totalRevenue = transactions.reduce((sum, txn) => sum + txn.getDisplayValue('total'), 0);
  const netSales = transactions.reduce((sum, txn) => sum + txn.getDisplayValue('netSales'), 0);
  const vatAmount = transactions.reduce((sum, txn) => sum + txn.getDisplayValue('vat'), 0);
  const totalTransactions = transactions.length;
  const averageTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // Calculate revenue change from previous period
  const previousRevenue = previousPeriodTransactions.reduce((sum, txn) => sum + txn.getDisplayValue('total'), 0);
  const revenueChange = previousRevenue > 0
    ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
    : 0;

  return {
    totalRevenue,
    netSales,
    vatAmount,
    totalTransactions,
    averageTransaction,
    revenueChange,
  };
}

/**
 * Generate daily sales trend data from transactions
 */
export function generateDailySalesTrend(transactions: Transaction[], dateRange?: { start: Date; end: Date }): SalesDataPoint[] {
  // Group transactions by date
  const transactionsByDate = new Map<string, Transaction[]>();

  transactions.forEach(txn => {
    // Use the transaction key as timestamp if available, otherwise use current date
    const timestamp = typeof txn.key === 'string' ? parseInt(txn.key) : Date.now();
    const date = moment.unix(timestamp).format('MMM DD');

    if (!transactionsByDate.has(date)) {
      transactionsByDate.set(date, []);
    }
    transactionsByDate.get(date)!.push(txn);
  });

  // Convert to array and calculate daily totals
  const dailyData: SalesDataPoint[] = [];

  // If date range is provided, generate all dates in range, otherwise use transaction dates
  if (dateRange) {
    const current = moment(dateRange.start);
    const end = moment(dateRange.end);

    while (current.isSameOrBefore(end)) {
      const dateKey = current.format('MMM DD');
      const dayTransactions = transactionsByDate.get(dateKey) || [];

      dailyData.push({
        date: dateKey,
        totalSales: dayTransactions.reduce((sum, txn) => sum + txn.getDisplayValue('total'), 0),
        netSales: dayTransactions.reduce((sum, txn) => sum + txn.getDisplayValue('netSales'), 0),
        vatAmount: dayTransactions.reduce((sum, txn) => sum + txn.getDisplayValue('vat'), 0),
        transactions: dayTransactions.length,
      });

      current.add(1, 'day');
    }
  } else {
    // Use existing transaction dates
    Array.from(transactionsByDate.entries())
      .sort(([a], [b]) => moment(a, 'MMM DD').valueOf() - moment(b, 'MMM DD').valueOf())
      .forEach(([date, dayTransactions]) => {
        dailyData.push({
          date,
          totalSales: dayTransactions.reduce((sum, txn) => sum + txn.getDisplayValue('total'), 0),
          netSales: dayTransactions.reduce((sum, txn) => sum + txn.getDisplayValue('netSales'), 0),
          vatAmount: dayTransactions.reduce((sum, txn) => sum + txn.getDisplayValue('vat'), 0),
          transactions: dayTransactions.length,
        });
      });
  }

  return dailyData;
}

/**
 * Generate payment method distribution data
 */
export function generatePaymentMethodData(transactions: Transaction[]): PaymentMethodData[] {
  const paymentCounts = new Map<string, { value: number; count: number }>();

  // Group transactions by payment type
  transactions.forEach(txn => {
    const paymentType = txn.paymentType || 'Cash'; // Default to Cash if not specified
    const amount = txn.getDisplayValue('total');

    if (!paymentCounts.has(paymentType)) {
      paymentCounts.set(paymentType, { value: 0, count: 0 });
    }

    const existing = paymentCounts.get(paymentType)!;
    existing.value += amount;
    existing.count += 1;
  });

  // Convert to array with percentages
  const totalAmount = Array.from(paymentCounts.values()).reduce((sum, { value }) => sum + value, 0);

  return Array.from(paymentCounts.entries()).map(([name, { value, count }]) => ({
    name,
    value,
    count,
    percentage: totalAmount > 0 ? (value / totalAmount) * 100 : 0,
  })).sort((a, b) => b.value - a.value); // Sort by value descending
}

/**
 * Generate sales breakdown by VAT categories
 */
export function generateSalesBreakdownData(transactions: Transaction[]): SalesBreakdownData[] {
  // For now, create a single "All Sales" category. In the future, this could be broken down
  // by time periods, product categories, or other dimensions
  const breakdown = transactions.reduce(
    (acc, txn) => ({
      vatableSales: acc.vatableSales + txn.getDisplayValue('$vatableSales'),
      vatExemptSales: acc.vatExemptSales + txn.getDisplayValue('$vatExemptSales'),
      zeroRatedSales: acc.zeroRatedSales + txn.getDisplayValue('$zeroRatedSales'),
      discounts: acc.discounts + txn.getDisplayValue('discount'),
      serviceCharges: acc.serviceCharges + txn.getDisplayValue('service'),
    }),
    {
      vatableSales: 0,
      vatExemptSales: 0,
      zeroRatedSales: 0,
      discounts: 0,
      serviceCharges: 0,
    }
  );

  return [
    {
      category: 'All Sales',
      ...breakdown,
    },
  ];
}

/**
 * Generate time-based sales breakdown (daily, weekly, etc.)
 */
export function generateTimePeriodBreakdown(
  transactions: Transaction[],
  groupBy: 'day' | 'week' | 'month' = 'day'
): SalesBreakdownData[] {
  const transactionsByPeriod = new Map<string, Transaction[]>();

  transactions.forEach(txn => {
    const timestamp = typeof txn.key === 'string' ? parseInt(txn.key) : Date.now();
    let periodKey: string;

    switch (groupBy) {
      case 'week':
        periodKey = moment.unix(timestamp).format('YYYY-[W]WW');
        break;
      case 'month':
        periodKey = moment.unix(timestamp).format('YYYY-MM');
        break;
      default: // day
        periodKey = moment.unix(timestamp).format('YYYY-MM-DD');
    }

    if (!transactionsByPeriod.has(periodKey)) {
      transactionsByPeriod.set(periodKey, []);
    }
    transactionsByPeriod.get(periodKey)!.push(txn);
  });

  return Array.from(transactionsByPeriod.entries()).map(([period, periodTransactions]) => {
    const breakdown = periodTransactions.reduce(
      (acc, txn) => ({
        vatableSales: acc.vatableSales + txn.getDisplayValue('$vatableSales'),
        vatExemptSales: acc.vatExemptSales + txn.getDisplayValue('$vatExemptSales'),
        zeroRatedSales: acc.zeroRatedSales + txn.getDisplayValue('$zeroRatedSales'),
        discounts: acc.discounts + txn.getDisplayValue('discount'),
        serviceCharges: acc.serviceCharges + txn.getDisplayValue('service'),
      }),
      {
        vatableSales: 0,
        vatExemptSales: 0,
        zeroRatedSales: 0,
        discounts: 0,
        serviceCharges: 0,
      }
    );

    return {
      category: formatPeriodLabel(period, groupBy),
      ...breakdown,
    };
  }).sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Format period labels for display
 */
function formatPeriodLabel(period: string, groupBy: 'day' | 'week' | 'month'): string {
  switch (groupBy) {
    case 'week':
      return moment(period, 'YYYY-[W]WW').format('[Week of] MMM DD');
    case 'month':
      return moment(period, 'YYYY-MM').format('MMMM YYYY');
    default: // day
      return moment(period, 'YYYY-MM-DD').format('MMM DD');
  }
}

/**
 * Generate sample data for testing/demo purposes
 */
export function generateSampleData() {
  const sampleTransactions: Partial<Transaction>[] = [];
  const today = moment();

  // Generate sample data for the last 7 days
  for (let i = 6; i >= 0; i--) {
    const date = today.clone().subtract(i, 'days');
    const numTransactions = Math.floor(Math.random() * 20) + 5; // 5-25 transactions per day

    for (let j = 0; j < numTransactions; j++) {
      const mockTransaction = {
        key: date.unix().toString(),
        paymentType: ['Cash', 'Credit Card', 'GCash', 'PayMaya'][Math.floor(Math.random() * 4)],
        total: (Math.random() * 2000 + 100) * Transaction.MONEY_PRECISION, // ₱100-₱2100
        $netSales: (Math.random() * 1800 + 90) * Transaction.MONEY_PRECISION,
        $vat: (Math.random() * 200 + 10) * Transaction.MONEY_PRECISION,
        $vatableSales: (Math.random() * 1500 + 80) * Transaction.MONEY_PRECISION,
        $vatExemptSales: (Math.random() * 200) * Transaction.MONEY_PRECISION,
        $zeroRatedSales: (Math.random() * 100) * Transaction.MONEY_PRECISION,
        discount: (Math.random() * 100) * Transaction.MONEY_PRECISION,
        service: (Math.random() * 50) * Transaction.MONEY_PRECISION,
        getDisplayValue: function(property: string) {
          const value = this[property as keyof typeof this] as number;
          return value / Transaction.MONEY_PRECISION;
        }
      } as any;

      sampleTransactions.push(mockTransaction);
    }
  }

  return sampleTransactions as Transaction[];
}
import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Receipt, CreditCard } from 'lucide-react';

interface RevenueData {
  totalRevenue: number;
  netSales: number;
  vatAmount: number;
  totalTransactions: number;
  averageTransaction: number;
  revenueChange: number; // percentage change from previous period
}

interface RevenueOverviewProps {
  data: RevenueData;
  isLoading?: boolean;
}

const MetricCard = ({
  title,
  value,
  change,
  icon: Icon,
  formatValue
}: {
  title: string;
  value: number;
  change?: number;
  icon: React.ElementType;
  formatValue?: (value: number) => string;
}) => {
  const isPositive = change !== undefined ? change >= 0 : true;
  const displayValue = formatValue ? formatValue(value) : value.toLocaleString();

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="bg-blue-50 p-3 rounded-lg">
            <Icon className="h-6 w-6 text-blue-600" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-2xl font-bold text-gray-900">{displayValue}</p>
          </div>
        </div>
        {change !== undefined && (
          <div className={`flex items-center ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? (
              <TrendingUp className="h-4 w-4 mr-1" />
            ) : (
              <TrendingDown className="h-4 w-4 mr-1" />
            )}
            <span className="text-sm font-medium">
              {Math.abs(change).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default function RevenueOverview({ data, isLoading = false }: RevenueOverviewProps) {
  const formatCurrency = (value: number) => {
    return '₱' + value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatInteger = (value: number) => {
    return value.toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="animate-pulse">
              <div className="flex items-center">
                <div className="bg-gray-200 p-3 rounded-lg w-12 h-12"></div>
                <div className="ml-4 flex-1">
                  <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                  <div className="h-8 bg-gray-200 rounded w-32"></div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Revenue Overview</h2>
        <div className="text-sm text-gray-500">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard
          title="Total Revenue"
          value={data.totalRevenue}
          change={data.revenueChange}
          icon={DollarSign}
          formatValue={formatCurrency}
        />

        <MetricCard
          title="Net Sales"
          value={data.netSales}
          icon={TrendingUp}
          formatValue={formatCurrency}
        />

        <MetricCard
          title="VAT Amount"
          value={data.vatAmount}
          icon={Receipt}
          formatValue={formatCurrency}
        />

        <MetricCard
          title="Total Transactions"
          value={data.totalTransactions}
          icon={CreditCard}
          formatValue={formatInteger}
        />

        <MetricCard
          title="Average Transaction"
          value={data.averageTransaction}
          icon={DollarSign}
          formatValue={formatCurrency}
        />
      </div>
    </div>
  );
}
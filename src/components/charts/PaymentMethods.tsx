import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';

interface PaymentMethodData {
  name: string;
  value: number;
  count: number;
  percentage: number;
}

interface PaymentMethodsProps {
  data: PaymentMethodData[];
  isLoading?: boolean;
  height?: number;
}

// Define colors for different payment methods
const COLORS = {
  'Cash': '#3b82f6',
  'Credit Card': '#10b981',
  'Debit Card': '#f59e0b',
  'GCash': '#8b5cf6',
  'PayMaya': '#ef4444',
  'Bank Transfer': '#06b6d4',
  'Other': '#6b7280',
};

const getColor = (name: string, index: number) => {
  return COLORS[name as keyof typeof COLORS] || `hsl(${index * 60}, 70%, 50%)`;
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 mb-1">{data.name}</p>
        <p className="text-sm text-gray-600">
          Amount: ₱{data.value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}
        </p>
        <p className="text-sm text-gray-600">
          Transactions: {data.count}
        </p>
        <p className="text-sm font-medium text-gray-900">
          {data.percentage.toFixed(1)}% of total
        </p>
      </div>
    );
  }
  return null;
};

const CustomLegend = (props: any) => {
  const { payload } = props;

  return (
    <div className="flex flex-wrap justify-center gap-4 mt-4">
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center">
          <div
            className="w-3 h-3 rounded-full mr-2"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-sm text-gray-600">
            {entry.value} ({entry.payload.percentage.toFixed(1)}%)
          </span>
        </div>
      ))}
    </div>
  );
};

export default function PaymentMethods({ data, isLoading = false, height = 400 }: PaymentMethodsProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 bg-gray-200 rounded w-48 animate-pulse"></div>
        </div>
        <div className="animate-pulse">
          <div className="h-80 bg-gray-200 rounded-full mx-auto" style={{ width: height * 0.8 }}></div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment Methods</h3>
        <div className="flex items-center justify-center h-80 text-gray-500">
          <div className="text-center">
            <p className="text-lg mb-2">No payment data available</p>
            <p className="text-sm">Payment method breakdown will appear here</p>
          </div>
        </div>
      </div>
    );
  }

  const totalAmount = data.reduce((sum, item) => sum + item.value, 0);
  const totalTransactions = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Payment Methods</h3>
          <p className="text-sm text-gray-500 mt-1">
            Distribution of payment types
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">
            Total: ₱{totalAmount.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </p>
          <p className="text-xs text-gray-500">
            {totalTransactions} transactions
          </p>
        </div>
      </div>

      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={120}
              innerRadius={40}
              fill="#8884d8"
              dataKey="value"
              label={({ name, payload }) => `${name}: ${payload.percentage.toFixed(1)}%`}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getColor(entry.name, index)}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Custom Legend */}
        <div className="mt-4">
          <CustomLegend payload={data.map((item, index) => ({
            value: item.name,
            color: getColor(item.name, index),
            payload: item
          }))} />
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-100">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">
            {data.length}
          </p>
          <p className="text-sm text-gray-500">Payment Methods</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">
            {totalTransactions}
          </p>
          <p className="text-sm text-gray-500">Total Transactions</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">
            ₱{(totalAmount / totalTransactions).toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0
            })}
          </p>
          <p className="text-sm text-gray-500">Avg Transaction</p>
        </div>
      </div>
    </div>
  );
}
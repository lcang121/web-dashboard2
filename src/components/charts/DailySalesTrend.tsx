import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

interface SalesDataPoint {
  date: string;
  totalSales: number;
  netSales: number;
  vatAmount: number;
  transactions: number;
}

interface DailySalesTrendProps {
  data: SalesDataPoint[];
  isLoading?: boolean;
  height?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 mb-2">{`Date: ${label}`}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {`${entry.name}: ₱${entry.value.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}`}
          </p>
        ))}
        {payload[0]?.payload?.transactions && (
          <p className="text-sm text-gray-600 mt-1">
            {`Transactions: ${payload[0].payload.transactions}`}
          </p>
        )}
      </div>
    );
  }
  return null;
};

export default function DailySalesTrend({ data, isLoading = false, height = 400 }: DailySalesTrendProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 bg-gray-200 rounded w-48 animate-pulse"></div>
          <div className="h-4 bg-gray-200 rounded w-32 animate-pulse"></div>
        </div>
        <div className="animate-pulse">
          <div className="h-80 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Sales Trend</h3>
        <div className="flex items-center justify-center h-80 text-gray-500">
          <div className="text-center">
            <p className="text-lg mb-2">No data available</p>
            <p className="text-sm">Sales data will appear here once transactions are recorded</p>
          </div>
        </div>
      </div>
    );
  }

  // Calculate percentage change from first to last data point
  const firstDay = data[0];
  const lastDay = data[data.length - 1];
  const percentChange = firstDay?.totalSales > 0
    ? ((lastDay?.totalSales - firstDay?.totalSales) / firstDay?.totalSales) * 100
    : 0;
  const isPositiveChange = percentChange >= 0;

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Daily Sales Trend</h3>
          <p className="text-sm text-gray-500 mt-1">
            Revenue and VAT over the selected period
          </p>
        </div>
        <div className="text-right">
          <div className={`flex items-center ${isPositiveChange ? 'text-green-600' : 'text-red-600'}`}>
            <span className="text-sm font-medium">
              {isPositiveChange ? '+' : ''}{percentChange.toFixed(1)}%
            </span>
          </div>
          <p className="text-xs text-gray-500">vs first day</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            tickLine={{ stroke: '#e5e7eb' }}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#6b7280' }}
            tickLine={{ stroke: '#e5e7eb' }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickFormatter={(value) => `₱${(value / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Line
            type="monotone"
            dataKey="totalSales"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: '#3b82f6' }}
            name="Total Sales"
          />
          <Line
            type="monotone"
            dataKey="netSales"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: '#10b981', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5, fill: '#10b981' }}
            name="Net Sales"
          />
          <Line
            type="monotone"
            dataKey="vatAmount"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ fill: '#f59e0b', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5, fill: '#f59e0b' }}
            name="VAT Amount"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
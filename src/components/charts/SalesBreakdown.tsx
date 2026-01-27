import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

interface SalesBreakdownData {
  category: string;
  vatableSales: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  discounts: number;
  serviceCharges: number;
}

interface SalesBreakdownProps {
  data: SalesBreakdownData[];
  isLoading?: boolean;
  height?: number;
  showDiscounts?: boolean;
  showServiceCharges?: boolean;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 mb-2">{`${label}`}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {`${entry.name}: ₱${entry.value.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function SalesBreakdown({
  data,
  isLoading = false,
  height = 400,
  showDiscounts = true,
  showServiceCharges = true
}: SalesBreakdownProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 bg-gray-200 rounded w-48 animate-pulse"></div>
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
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Breakdown</h3>
        <div className="flex items-center justify-center h-80 text-gray-500">
          <div className="text-center">
            <p className="text-lg mb-2">No sales data available</p>
            <p className="text-sm">VAT breakdown will appear here once transactions are recorded</p>
          </div>
        </div>
      </div>
    );
  }

  // Calculate totals for summary
  const totals = data.reduce(
    (acc, item) => ({
      vatableSales: acc.vatableSales + item.vatableSales,
      vatExemptSales: acc.vatExemptSales + item.vatExemptSales,
      zeroRatedSales: acc.zeroRatedSales + item.zeroRatedSales,
      discounts: acc.discounts + item.discounts,
      serviceCharges: acc.serviceCharges + item.serviceCharges,
    }),
    {
      vatableSales: 0,
      vatExemptSales: 0,
      zeroRatedSales: 0,
      discounts: 0,
      serviceCharges: 0,
    }
  );

  const totalSales = totals.vatableSales + totals.vatExemptSales + totals.zeroRatedSales;

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Sales Breakdown</h3>
          <p className="text-sm text-gray-500 mt-1">
            VAT categories and adjustments
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">
            Total Sales: ₱{totalSales.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </p>
          {(totals.discounts > 0 || totals.serviceCharges > 0) && (
            <p className="text-xs text-gray-500">
              Net: ₱{(totalSales - totals.discounts + totals.serviceCharges).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </p>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="category"
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

          {/* Main sales categories */}
          <Bar
            dataKey="vatableSales"
            fill="#3b82f6"
            name="VATable Sales"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="vatExemptSales"
            fill="#10b981"
            name="VAT-Exempt Sales"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="zeroRatedSales"
            fill="#f59e0b"
            name="Zero-Rated Sales"
            radius={[0, 0, 0, 0]}
          />

          {/* Optional adjustments */}
          {showDiscounts && (
            <Bar
              dataKey="discounts"
              fill="#ef4444"
              name="Discounts"
              radius={[0, 0, 0, 0]}
            />
          )}
          {showServiceCharges && (
            <Bar
              dataKey="serviceCharges"
              fill="#8b5cf6"
              name="Service Charges"
              radius={[0, 0, 0, 0]}
            />
          )}
        </BarChart>
      </ResponsiveContainer>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-6 pt-4 border-t border-gray-100">
        <div className="text-center p-3 bg-blue-50 rounded-lg">
          <p className="text-lg font-bold text-blue-700">
            ₱{(totals.vatableSales / 1000).toFixed(0)}k
          </p>
          <p className="text-xs text-blue-600">VATable Sales</p>
          <p className="text-xs text-gray-500">
            {totalSales > 0 ? ((totals.vatableSales / totalSales) * 100).toFixed(1) : 0}%
          </p>
        </div>

        <div className="text-center p-3 bg-green-50 rounded-lg">
          <p className="text-lg font-bold text-green-700">
            ₱{(totals.vatExemptSales / 1000).toFixed(0)}k
          </p>
          <p className="text-xs text-green-600">VAT-Exempt</p>
          <p className="text-xs text-gray-500">
            {totalSales > 0 ? ((totals.vatExemptSales / totalSales) * 100).toFixed(1) : 0}%
          </p>
        </div>

        <div className="text-center p-3 bg-yellow-50 rounded-lg">
          <p className="text-lg font-bold text-yellow-700">
            ₱{(totals.zeroRatedSales / 1000).toFixed(0)}k
          </p>
          <p className="text-xs text-yellow-600">Zero-Rated</p>
          <p className="text-xs text-gray-500">
            {totalSales > 0 ? ((totals.zeroRatedSales / totalSales) * 100).toFixed(1) : 0}%
          </p>
        </div>

        {showDiscounts && (
          <div className="text-center p-3 bg-red-50 rounded-lg">
            <p className="text-lg font-bold text-red-700">
              ₱{(totals.discounts / 1000).toFixed(0)}k
            </p>
            <p className="text-xs text-red-600">Discounts</p>
            <p className="text-xs text-gray-500">
              {totalSales > 0 ? ((totals.discounts / totalSales) * 100).toFixed(1) : 0}%
            </p>
          </div>
        )}

        {showServiceCharges && (
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <p className="text-lg font-bold text-purple-700">
              ₱{(totals.serviceCharges / 1000).toFixed(0)}k
            </p>
            <p className="text-xs text-purple-600">Service</p>
            <p className="text-xs text-gray-500">
              {totalSales > 0 ? ((totals.serviceCharges / totalSales) * 100).toFixed(1) : 0}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
import React, { useState, useEffect, useMemo } from 'react';
import { saveProductMix } from '../hooks';
import Moment from 'moment-timezone';
import { Menu, Download, Loader } from 'lucide-react';
import { ref, query, orderByKey, startAt, endAt, onValue, off } from 'firebase/database';
import { database } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import Transaction from '../../../models/Transaction';
import _ from 'lodash-es';

interface MixRow {
  item: string;
  option: string;
  category: string;
  quantity: number;
  sales: number; // pesos
}

const peso = (n: number) =>
  '₱' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProductMixTab() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(() =>
    Math.floor(Moment().subtract(6, 'days').startOf('day').unix())
  );
  const [endS, setEndS] = useState(() => Math.floor(Moment().endOf('day').unix()));

  const [data, setData] = useState<{ loading: boolean; rows: MixRow[] }>({
    loading: true,
    rows: [],
  });
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  const startDateString = Moment.unix(sttS).format('YYYY-MM-DDTHH:mm');
  const endDateString = Moment.unix(endS).format('YYYY-MM-DDTHH:mm');

  useEffect(() => {
    if (!user?.uid) {
      setData({ loading: false, rows: [] });
      return;
    }
    setData(d => ({ ...d, loading: true }));

    const txnsRef = ref(database, `${user.uid}/transactions`);
    const txnsQuery = query(txnsRef, orderByKey(), startAt(`${sttS}`), endAt(`${endS}`));

    const handleUpdate = _.debounce((snapshot: any) => {
      const mix = new Map<string, MixRow>();
      if (snapshot.exists()) {
        Object.entries(snapshot.val()).forEach(([key, val]) => {
          if ((val as any)?.trainingMode) return;
          const txn = new Transaction({ key: parseInt(key, 10), val: val as any });
          for (const item of txn.items) {
            if (!item) continue;
            // Only actually-sold rows: positive qty, not a reversed/adjustment item.
            if (item.quantity <= 0) continue;
            const o = item.original || {};
            if (o.refunded || o.returned || o.voided || o.refund != null || o.return != null) continue;
            const title = o.title || '(unnamed)';
            const option = o.option || '';
            const category = o.categoryOriginal || o.category || '';
            const mapKey = `${title}|${option}`;
            const sales = (item.quantity * item.price) / Transaction.MONEY_PRECISION;
            const cur = mix.get(mapKey) || { item: title, option, category, quantity: 0, sales: 0 };
            cur.quantity += item.quantity;
            cur.sales += sales;
            mix.set(mapKey, cur);
          }
        });
      }
      const rows = [...mix.values()].sort((a, b) => b.sales - a.sales);
      setData({ loading: false, rows });
    }, 500);

    onValue(txnsQuery, handleUpdate);
    return () => off(txnsQuery, 'value', handleUpdate);
  }, [sttS, endS, user?.uid]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sttS, endS]);

  const { totalQty, totalSales } = useMemo(() => {
    let q = 0;
    let s = 0;
    for (const r of data.rows) {
      q += r.quantity;
      s += r.sales;
    }
    return { totalQty: q, totalSales: s };
  }, [data.rows]);

  const handleDownload = async () => {
    try {
      setDownloadLoading(true);
      await saveProductMix(
        Moment.unix(sttS).format('YYMMDD'),
        Moment.unix(endS).format('YYMMDD'),
        false,
      );
    } catch (error) {
      console.error('Error downloading product mix:', error);
      alert('Error downloading report: ' + error);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleDateChange = (type: 'start' | 'end', value: string) => {
    const timestamp = Math.floor(new Date(value).getTime() / 1000);
    if (type === 'start') setSttS(timestamp);
    else setEndS(timestamp);
  };

  const totalPages = Math.ceil(data.rows.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginated = data.rows.slice(startIndex, endIndex);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2">
            <Menu size={28} className="text-gray-600" />
          </div>

          <div className="flex flex-col md:flex-row gap-4 flex-1 md:max-w-2xl">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">From:</label>
              <input
                type="datetime-local"
                value={startDateString}
                onChange={(e) => handleDateChange('start', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-utak-darkseagreen focus:border-transparent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">To:</label>
              <input
                type="datetime-local"
                value={endDateString}
                onChange={(e) => handleDateChange('end', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-utak-darkseagreen focus:border-transparent"
              />
            </div>
          </div>

          <button
            onClick={handleDownload}
            disabled={!data.rows.length || downloadLoading}
            className="flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700">
            {downloadLoading ? <Loader size={20} className="animate-spin" /> : <Download size={20} />}
            {downloadLoading ? 'Saving...' : 'Save XLSX'}
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      {!data.loading && data.rows.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-utak-darkseagreen">{data.rows.length}</p>
            <p className="text-xs text-gray-500 uppercase">Products</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{totalQty.toLocaleString()}</p>
            <p className="text-xs text-gray-500 uppercase">Units Sold</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{peso(totalSales)}</p>
            <p className="text-xs text-gray-500 uppercase">Gross Sales</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {data.loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <Loader size={32} className="animate-spin text-utak-darkseagreen" />
              <p className="text-gray-600">Loading product mix...</p>
            </div>
          </div>
        ) : data.rows.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500 text-center">No product sales found for the selected date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Item</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Option</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Category</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-blue-700 uppercase">Qty Sold</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-green-700 uppercase">Gross Sales</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">% of Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginated.map((r, idx) => (
                  <tr key={`${r.item}-${r.option}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-500">{startIndex + idx + 1}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{r.item}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{r.option || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{r.category || '—'}</td>
                    <td className="px-6 py-4 text-sm text-blue-600 font-medium text-right">{r.quantity.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-green-600 font-medium text-right">{peso(r.sales)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 text-right">
                      {totalSales > 0 ? ((r.sales / totalSales) * 100).toFixed(1) : '0.0'}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!data.loading && data.rows.length > 0 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                <span className="font-semibold">{Math.min(endIndex, data.rows.length)}</span> of{' '}
                <span className="font-semibold">{data.rows.length}</span> products
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="First page">⟨⟨</button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">← Previous</button>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Page</span>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={currentPage}
                    onChange={(e) => {
                      const page = parseInt(e.target.value) || 1;
                      setCurrentPage(Math.min(Math.max(1, page), totalPages));
                    }}
                    className="w-12 px-2 py-1 text-sm border border-gray-300 rounded text-center"
                  />
                  <span className="text-sm text-gray-600">of {totalPages}</span>
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Next →</button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Last page">⟩⟩</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

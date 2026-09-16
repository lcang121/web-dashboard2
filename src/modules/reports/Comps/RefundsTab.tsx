import React, { useState, useEffect } from 'react';
import { saveRefunds } from '../hooks';
import Moment from 'moment-timezone';
import { Menu, Calendar, Download, Loader } from 'lucide-react';
import { ref, query, orderByKey, startAt, endAt, onValue, off } from 'firebase/database';
import { database } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import Transaction from '../../../models/Transaction';
import TransactionItem from '../../../models/TransactionItem';
import _ from 'lodash-es';

const MP = Transaction.MONEY_PRECISION;

const mapPaxDiscType = (discType?: string) => {
  if (discType === 'ntl') return 'ntlAthlete';
  if (discType === 'sp') return 'soloParent';
  return discType || '';
};

export default function RefundsTab() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(() =>
    Math.floor(Moment().subtract(6, 'days').startOf('day').unix())
  );
  const [endS, setEndS] = useState(() =>
    Math.floor(Moment().endOf('day').unix())
  );

  const [refundsData, setRefundsData] = useState({
    loading: true,
    value: [] as Transaction[],
  });

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Date formatting for input
  const startDateString = Moment.unix(sttS).format('YYYY-MM-DDTHH:mm');
  const endDateString = Moment.unix(endS).format('YYYY-MM-DDTHH:mm');

  // Fetch refunds from Firebase Realtime Database
  useEffect(() => {
    if (!user?.uid) {
      setRefundsData({ loading: false, value: [] });
      return;
    }

    setRefundsData(v => ({ ...v, loading: true }));

    // Create query for refunds within date range
    const refundsRef = ref(database, `${user.uid}/refunds`);
    const refundsQuery = query(
      refundsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS}`)
    );

    // Debounced callback to handle data updates
    const handleRefundsUpdate = _.debounce((snapshot) => {
      const refunds: Transaction[] = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Iterate through refunds and create Transaction instances
        Object.entries(data).forEach(([key, val]) => {
          const refund = new Transaction({ key: parseInt(key), val });
          refunds.unshift(refund); // Sort in reverse (newest first)
        });
      }
      setRefundsData({ loading: false, value: refunds });
    }, 500);

    // Listen for value changes
    onValue(refundsQuery, handleRefundsUpdate);

    // Cleanup listener on unmount or when dependencies change
    return () => {
      off(refundsQuery, 'value', handleRefundsUpdate);
    };
  }, [sttS, endS, user?.uid]);

  const handleDownload = async () => {
    try {
      setDownloadLoading(true);
      await saveRefunds(
        Moment.unix(sttS).format('YYMMDD'),
        Moment.unix(endS).format('YYMMDD'),
        false
      );
    } catch (error) {
      console.error('Error downloading refunds report:', error);
      alert('Error downloading report: ' + error);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleDateChange = (type, value) => {
    const date = new Date(value);
    const timestamp = Math.floor(date.getTime() / 1000);
    if (type === 'start') {
      setSttS(timestamp);
    } else {
      setEndS(timestamp);
    }
  };

  const getRefundMetrics = (refund: Transaction) => {
    const raw = refund.original || {};
    const refundKey = String(refund.key);
    const matchKey = raw.originalRefundKey != null ? String(raw.originalRefundKey) : refundKey;
    const refundedItems = (raw.items || []).filter(
      (item: any) => item?.refund != null && String(item.refund) === matchKey,
    );

    const $txnRefund = refundedItems.length
      ? new Transaction({ key: refundKey, val: { ...raw, items: refundedItems } })
      : ({ $vatableSales: 0, $vatExemptSales: 0, $zeroRatedSales: 0, $vat: 0, $service: 0 } as any);

    const salesAdjustment = Math.abs(
      ((Number(($txnRefund as any).$vatableSales) || 0) +
        (Number(($txnRefund as any).$vatExemptSales) || 0) +
        (Number(($txnRefund as any).$zeroRatedSales) || 0)) / MP,
    );
    const vatAdjustment = Math.abs(Number(($txnRefund as any).$vat) || 0) / MP;
    const serviceCharge = Math.abs(Number(($txnRefund as any).$service) || 0) / MP;

    const totalDiscountMP = refundedItems.reduce((sum: number, item: any, i: number) => {
      const $itm = new TransactionItem({ val: item, key: i } as any);
      const d = ($itm as any)._parts?.discount != null
        ? Math.abs(Number(($itm as any)._parts.discount) || 0)
        : Math.abs(Number(($itm as any).$discount) || 0);
      return sum + d;
    }, 0);

    const itemDiscountTypes = [
      ...new Set(
        refundedItems.flatMap((item: any) => {
          const types: string[] = [];
          const explicit = item?.individualDiscountType || item?.transactionDiscountType || '';
          if (explicit) types.push(explicit);
          if (item?.paxDiscount && typeof item.paxDiscount === 'object') {
            for (const k of Object.keys(item.paxDiscount)) {
              const mapped = mapPaxDiscType(k);
              if (mapped) types.push(mapped);
            }
          }
          return types;
        }),
      ),
    ].join('; ');

    const discountType = raw.transactionDiscountType || itemDiscountTypes;
    const discountAmount = totalDiscountMP > 0 ? totalDiscountMP / MP : 0;

    return {
      salesAdjustment,
      vatAdjustment,
      serviceCharge,
      zTotalRefundEffect: salesAdjustment + vatAdjustment + serviceCharge,
      discountType,
      discountAmount,
      refundedItemsCount: refundedItems.length,
    };
  };

  // Pagination calculations
  const totalPages = Math.ceil(refundsData.value.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedRefunds = refundsData.value.slice(startIndex, endIndex);

  // Reset to first page when date range changes
  useEffect(() => {
    setCurrentPage(1);
  }, [sttS, endS]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header with Date Pickers */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2">
            <Menu size={28} className="text-gray-600" />
          </div>

          {/* Date Range Selection */}
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

          {/* Save Report Button */}
          <button
            onClick={handleDownload}
            disabled={!refundsData.value.length || downloadLoading}
            className="flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed bg-utak-darkseagreen hover:bg-utak-darkgreen">
            {downloadLoading ? (
              <Loader size={20} className="animate-spin" />
            ) : (
              <Download size={20} />
            )}
            {downloadLoading ? 'Saving...' : 'Save Report'}
          </button>
        </div>
      </div>

      {/* Refunds Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {refundsData.loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <Loader size={32} className="animate-spin text-utak-darkseagreen" />
              <p className="text-gray-600">Loading refunds...</p>
            </div>
          </div>
        ) : refundsData.value.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500 text-center">No refunds found for the selected date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Time</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-utak-orange uppercase">Refunded Amount</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-utak-darkgreen uppercase">Original Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Refunded Items</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Discount Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedRefunds.map((refund, idx) => {
                  const m = getRefundMetrics(refund);
                  return (
                  <tr key={`${refund.key}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {Moment.unix(Number(refund.key)).format('DD MMM YYYY')}
                    </td>
                    <td className="px-6 py-4 text-sm text-utak-darkseagreen font-medium">
                      {Moment.unix(Number(refund.key)).format('h:mm a')}
                    </td>
                    <td className="px-6 py-4 text-sm text-utak-orange font-medium text-right">
                      ₱{m.zTotalRefundEffect.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-utak-darkgreen font-medium text-right">
                      {refund.getFormattedCurrency('$amountDue')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-right">
                      {m.refundedItemsCount} of {refund.items?.length || 0}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {m.discountType || '—'}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        {!refundsData.loading && refundsData.value.length > 0 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                <span className="font-semibold">{Math.min(endIndex, refundsData.value.length)}</span> of{' '}
                <span className="font-semibold">{refundsData.value.length}</span> records
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="First page">
                  ⟨⟨
                </button>

                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
                  ← Previous
                </button>

                {/* Page Info */}
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
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
                  Next →
                </button>

                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Last page">
                  ⟩⟩
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

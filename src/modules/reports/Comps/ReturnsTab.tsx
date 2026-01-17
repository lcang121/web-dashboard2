import React, { useState, useEffect } from 'react';
import { saveTransactions } from '../hooks';
import Moment from 'moment-timezone';
import { Menu, Download, Loader } from 'lucide-react';
import { ref, query, orderByKey, startAt, endAt, onValue, off } from 'firebase/database';
import { database } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import Transaction from '../../../models/Transaction';
import _ from 'lodash-es';

export default function ReturnsTab() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(() =>
    Math.floor(Moment().subtract(6, 'days').startOf('day').unix())
  );
  const [endS, setEndS] = useState(() =>
    Math.floor(Moment().endOf('day').unix())
  );

  const [returnsData, setReturnsData] = useState({
    loading: true,
    value: [] as Transaction[],
  });

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Date formatting for input
  const startDateString = Moment.unix(sttS).format('YYYY-MM-DDTHH:mm');
  const endDateString = Moment.unix(endS).format('YYYY-MM-DDTHH:mm');

  // Fetch returns from Firebase Realtime Database
  useEffect(() => {
    if (!user?.uid) {
      setReturnsData({ loading: false, value: [] });
      return;
    }

    setReturnsData(v => ({ ...v, loading: true }));

    // Create query for returns within date range (using transactions collection with negative quantities)
    const transactionsRef = ref(database, `${user.uid}/transactions`);
    const transactionsQuery = query(
      transactionsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS}`)
    );

    // Debounced callback to handle data updates
    const handleReturnsUpdate = _.debounce((snapshot) => {
      const returns: Transaction[] = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Iterate through transactions and find returns (transactions with negative quantities)
        Object.entries(data).forEach(([key, val]) => {
          const transaction = new Transaction({ key: parseInt(key), val });
          // Check if this transaction has returned items (negative quantities)
          const hasReturns = transaction.items.some(item => item && item.quantity < 0);
          if (hasReturns) {
            returns.unshift(transaction); // Sort in reverse (newest first)
          }
        });
      }
      setReturnsData({ loading: false, value: returns });
    }, 500);

    // Listen for value changes
    onValue(transactionsQuery, handleReturnsUpdate);

    // Cleanup listener on unmount or when dependencies change
    return () => {
      off(transactionsQuery, 'value', handleReturnsUpdate);
    };
  }, [sttS, endS, user?.uid]);

  const handleDownload = async () => {
    try {
      setDownloadLoading(true);
      // Use saveTransactions with isManual=false for returns (they'll be filtered on the server side)
      await saveTransactions(sttS, endS, false);
    } catch (error) {
      console.error('Error downloading returns report:', error);
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

  const getReturnedAmount = (transaction: Transaction) => {
    // Calculate the amount for returned items (negative quantities)
    let returnedAmount = 0;
    transaction.items.forEach(item => {
      if (item && item.quantity < 0) {
        returnedAmount += Math.abs(item.quantity * item.price);
      }
    });
    return returnedAmount / Transaction.MONEY_PRECISION;
  };

  const getReturnedItemsCount = (transaction: Transaction) => {
    return transaction.items.filter(item => item && item.quantity < 0).length;
  };

  // Pagination calculations
  const totalPages = Math.ceil(returnsData.value.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedReturns = returnsData.value.slice(startIndex, endIndex);

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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">To:</label>
              <input
                type="datetime-local"
                value={endDateString}
                onChange={(e) => handleDateChange('end', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Save Report Button */}
          <button
            onClick={handleDownload}
            disabled={!returnsData.value.length || downloadLoading}
            className="flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700">
            {downloadLoading ? (
              <Loader size={20} className="animate-spin" />
            ) : (
              <Download size={20} />
            )}
            {downloadLoading ? 'Saving...' : 'Save Report'}
          </button>
        </div>
      </div>

      {/* Returns Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {returnsData.loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <Loader size={32} className="animate-spin text-blue-600" />
              <p className="text-gray-600">Loading returns...</p>
            </div>
          </div>
        ) : returnsData.value.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500 text-center">No returns found for the selected date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Time</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-orange-700 uppercase">Returned Amount</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-green-700 uppercase">Original Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-blue-700 uppercase">Service</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Returned Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedReturns.map((returnTxn, idx) => (
                  <tr key={`${returnTxn.key}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {Moment.unix(Number(returnTxn.key)).format('DD MMM YYYY')}
                    </td>
                    <td className="px-6 py-4 text-sm text-blue-600 font-medium">
                      {Moment.unix(Number(returnTxn.key)).format('h:mm a')}
                    </td>
                    <td className="px-6 py-4 text-sm text-orange-600 font-medium text-right">
                      ₱{getReturnedAmount(returnTxn).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-green-600 font-medium text-right">
                      {returnTxn.getFormattedCurrency('$amountDue')}
                    </td>
                    <td className="px-6 py-4 text-sm text-blue-600 font-medium text-right">
                      {returnTxn.getFormattedCurrency('$service')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-right">
                      {getReturnedItemsCount(returnTxn)} of {returnTxn.items?.length || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        {!returnsData.loading && returnsData.value.length > 0 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                <span className="font-semibold">{Math.min(endIndex, returnsData.value.length)}</span> of{' '}
                <span className="font-semibold">{returnsData.value.length}</span> records
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

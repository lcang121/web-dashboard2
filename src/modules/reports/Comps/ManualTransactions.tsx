import React, { useState, useEffect } from 'react';
import { saveTransactions } from '../hooks';
import Moment from 'moment-timezone';
import { Menu, Calendar, Download, Loader } from 'lucide-react';
import { ref, query, orderByKey, startAt, endAt, onValue, off } from 'firebase/database';
import { database } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import Transaction from '../../../models/Transaction';
import _ from 'lodash-es';

export default function ManualTransactions() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(() =>
    Math.floor(Moment().subtract(6, 'days').startOf('day').unix())
  );
  const [endS, setEndS] = useState(() =>
    Math.floor(Moment().endOf('day').unix())
  );

  const [manualTxnsData, setManualTxnsData] = useState({
    loading: true,
    value: [] as Transaction[],
  });

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Date formatting for input
  const startDateString = Moment.unix(sttS).format('YYYY-MM-DDTHH:mm');
  const endDateString = Moment.unix(endS).format('YYYY-MM-DDTHH:mm');

  // Fetch manual transactions from Firebase Realtime Database
  useEffect(() => {
    if (!user?.uid) {
      setManualTxnsData({ loading: false, value: [] });
      return;
    }

    setManualTxnsData(v => ({ ...v, loading: true }));

    // Create query for manual transactions within date range
    const manualTxnsRef = ref(database, `${user.uid}/manual_transactions`);
    const manualTxnsQuery = query(
      manualTxnsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS}`)
    );

    // Debounced callback to handle data updates
    const handleManualTxnsUpdate = _.debounce((snapshot) => {
      const txns: Transaction[] = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Iterate through manual transactions and create Transaction instances
        Object.entries(data).forEach(([key, val]) => {
          const transaction = new Transaction({ key: parseInt(key), val });
          txns.unshift(transaction); // Sort in reverse (newest first)
        });
      }
      setManualTxnsData({ loading: false, value: txns });
    }, 500);

    // Listen for value changes
    onValue(manualTxnsQuery, handleManualTxnsUpdate);

    // Cleanup listener on unmount or when dependencies change
    return () => {
      off(manualTxnsQuery, 'value', handleManualTxnsUpdate);
    };
  }, [sttS, endS, user?.uid]);

  const handleDownload = async () => {
    try {
      setDownloadLoading(true);
      await saveTransactions(sttS, endS, true); // isManual=true
    } catch (error) {
      console.error('Error downloading manual transactions report:', error);
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

  // Pagination calculations
  const totalPages = Math.ceil(manualTxnsData.value.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTxns = manualTxnsData.value.slice(startIndex, endIndex);

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
            disabled={!manualTxnsData.value.length || downloadLoading}
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

      {/* Manual Transactions Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {manualTxnsData.loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <Loader size={32} className="animate-spin text-blue-600" />
              <p className="text-gray-600">Loading manual transactions...</p>
            </div>
          </div>
        ) : manualTxnsData.value.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500 text-center">No manual transactions found for the selected date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-blue-700 uppercase">Manual Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-purple-700 uppercase">Receipt No</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-green-700 uppercase">Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-blue-700 uppercase">Service</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedTxns.map((txn, idx) => (
                  <tr key={`${txn.key}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {Moment.unix(Number(txn.key)).format('DD MMM YYYY')}
                    </td>
                    <td className="px-6 py-4 text-sm text-blue-600 font-medium">
                      {Moment.unix(Number(txn.key)).format('h:mm a')}
                    </td>
                    <td className="px-6 py-4 text-sm text-blue-600">
                      {txn.original.manualReference || '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-purple-600">
                      {txn.original.receiptNo || '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-green-600 font-medium text-right">
                      {txn.getFormattedCurrency('$amountDue')}
                    </td>
                    <td className="px-6 py-4 text-sm text-blue-600 font-medium text-right">
                      {txn.getFormattedCurrency('$service')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-right">
                      {txn.items?.length || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        {!manualTxnsData.loading && manualTxnsData.value.length > 0 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                <span className="font-semibold">{Math.min(endIndex, manualTxnsData.value.length)}</span> of{' '}
                <span className="font-semibold">{manualTxnsData.value.length}</span> records
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
